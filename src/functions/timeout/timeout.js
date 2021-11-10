const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');

const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'locahost';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

/**
 * Timeout handler
 * 
 * 1. Use `multi` to chain Redis commands
 * 2. Commands are zrangebyscore to retrieve expired id, zremrangebyscore to remove them
 * 3. Send events for ids
 */
exports.handler = async function() {
    // Get list of friends
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        ssl: true
    });
    try {
        await client.connect();
    } catch (err) {
        console.log(err);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(err) };
    }
    
    const timestamp = Date.now() - parseInt(process.env.TIMEOUT, 10);
    const commands = redisPresence.multi();
    commands.zrangebyscore("status", "-inf", timestamp);
    commands.zremrangebyscore("status", "-inf", timestamp);
    const execute = promisify(commands.exec).bind(commands);
    
    let userIdArr;
    try {
        // Multiple commands results are returned as an array of result, one entry per command
        // `userIds` is the result of the first command
        [userIdArr] = await execute();
        console.log('userIdArr', userIdArr);
        // remove page of userIds
        if (userIdArr.length > 0) {
            await hdel("page", userIdArr);
        }
    } catch (error) {
        console.log(error);
        userIdArr = [];
    }
    
    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: process.env.WSS_DOMAIN_NAME.replace('wss://', '') + '/' + process.env.WSS_STAGE
    });

    for (const userId of userIdArr) {
        let friendIdArr = [];
        try {
            const text = `
                SELECT * FROM friendship_table
                WHERE (user_id1 = $1 OR user_id2 = $1) AND
                    accepted_at IS NOT NULL
            `;
            const values = [userId];
            let result = await client.query(text, values);
            console.log(result.rows);
            friendIdArr = result.rows.map(x => x.user_id1 === userId ? x.user_id2 : x.user_id1);
        } catch (error) {
            await client.end();
            console.log(error);
            return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
        }
        
        let connectionDataArr = [];  // Array of object whose keys are friendId, connectionId
        try {
            let connectionIdArr = await hmget("presence_user_connection", friendIdArr);
            connectionDataArr = connectionIdArr.map((x, i) => {
                return { friendId: friendIdArr[i], connectionId: x };
            }).filter(x => x.connectionId);
        } catch (error) {
            console.log(error);
            return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
        }
        
        const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
            try {
                await apigwManagementApi.postToConnection({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'presence-timeout',
                        userId: userId
                    })
                }).promise();
            } catch (error) {
                console.log(error);
                if (error.statusCode === 410) {
                    console.log(`Found stale connection, deleting ${connectionId}`);
                    await hdel("presence_user_connection", friendId).promise();
                    await hdel("presence_connection_user", connectionId).promise();
                } else {
                    throw error;
                }
            }
        });
        
        try {
            await Promise.all(postCalls);
        } catch (error) {
            return { statusCode: 500, body: error.stack };
        }
    }
    await client.end();
    
    return { statusCode: 200, body: 'Data sent' };
};
