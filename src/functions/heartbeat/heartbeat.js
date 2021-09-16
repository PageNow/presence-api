const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

exports.handler = async function(event) {
    const eventData = JSON.parse(event.body);
    if (eventData.url == undefined || eventData.url == null) {
        throw new Error("url is not included in the event body");
    }
    if (eventData.title == undefined || eventData.title == undefined) {
        throw new Error("title is not included in the event body");
    }
    if (eventData.userId == undefined || eventData.userId == undefined) {
        throw new Error("userId is not included in the event body");
    }
    const url = eventData.url;
    const title = eventData.title;
    const userId = eventData.userId;

    // Update status and page on redis
    try {
        const commands = redisPresence.multi();
        commands.zadd('status', Date.now(), userId);
        commands.hset('page', userId, JSON.stringify({url: url, title: title}));
        const execute = promisify(commands.exec).bind(commands);
        await execute();
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    if (event.body.updatePresence) {
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
            friendIdArr = result.rows.map(x => x.userId1 === userId ? x.userId2 : x.userId1);
        } catch (error) {
            await client.end();
            console.log(error);
            return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
        }
        await client.end();

        // get connectionId of all friends
        let connectionDataArr = [];  // Array of object whose keys are friendId, connectionId
        try {
            let connectionIdArr = await hmget("user_connection", friendIdArr);
            connectionDataArr = connectionIdArr.map((x, i) => {
                return { friendId: friendIdArr[i], connectionId: x };
            }).filter(x => x.connectionId);
        } catch (error) {
            console.log(error);
            return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
        }
        connectionDataArr.push({ friendId: userId, connectionId: event.requestContext.connectionId });

        const apigwManagementApi = new AWS.ApiGatewayManagementApi({
            apiVersion: '2018-11-29',
            endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
        });
        // post to all connections
        const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
            try {
                await apigwManagementApi.postToConnection({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: 'update-presence',
                        userId: userId,
                        url: url,
                        title: title
                    })
                }).promise();
            } catch (error) {
                if (error.statusCode === 410) {
                    console.log(`Found stale connection, deleting ${connectionId}`);
                    await hdel("user_connection", friendId);
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
    
    return { statusCode: 200, body: 'Data sent' };
};
