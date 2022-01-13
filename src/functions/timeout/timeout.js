const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const constants = require('/opt/nodejs/constants');

// Redis connection variables
const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'locahost';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

// promisified Redis commands
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

exports.handler = async function() {
    // connect to AWS RDS PostgreSQL
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
    
    // set the time to determine whether the user is offline or not
    const timestamp = Date.now() - parseInt(process.env.TIMEOUT, 10);
    const commands = redisPresence.multi(); // use transaction for Redis commands
    // remove all the members whose score (latest activity timestamp) is before the cut-off time (i.e. stale timestamp)
    commands.zrangebyscore(constants.REDIS_KEY_STATUS, "-inf", timestamp);
    commands.zremrangebyscore(constants.REDIS_KEY_STATUS, "-inf", timestamp);
    const execute = promisify(commands.exec).bind(commands);
    
    let userIdArr; // list of users who are offline
    try {
        // The results of multiple commands are returned as an array of result, one entry per command
        // `userIds` is the result of the first command
        [userIdArr] = await execute();
        console.log('userIdArr', userIdArr);
        // remove presence data of userIds
        if (userIdArr.length > 0) {
            await hdel(constants.REDIS_KEY_PAGE, userIdArr);
            await hdel(constants.REDIS_KEY_LATEST_PAGE, userIdArr);
        }
    } catch (error) {
        console.log(error);
        userIdArr = [];
    }
    
    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: process.env.WSS_DOMAIN_NAME.replace('wss://', '') + '/' + process.env.WSS_STAGE
    });

    for (const userId of userIdArr) { // for every user who is offline
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
        
        // array of object { friendId: friend id, connectionId, connection id }
        let connectionDataArr = [];
        try {
            let connectionIdArr = await hmget(constants.REDIS_KEY_USER_CONNECTION, friendIdArr);
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
                    await hdel(constants.REDIS_KEY_USER_CONNECTION, friendId).promise();
                    await hdel(constants.REDIS_KEY_CONNECTION_USER, connectionId).promise();
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

        // save TIMEOUT event to UserActivityHistoryTable
        try {
            const result = await dynamoDB.putItem({
                TableName: process.env.USER_ACTIVITY_HISTORY_TABLE_NAME,
                Item: {
                    user_id: { S: userId },
                    timestamp: { S: new Date(Date.now()).toISOString() },
                    type: { S: "TIMEOUT" }
                }
            }).promise();
            console.log(result);
        } catch (error) {
            console.log(error);
        }
    }
    await client.end();
    
    return { statusCode: 200, body: 'Data sent' };
};
