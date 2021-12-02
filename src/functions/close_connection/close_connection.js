const AWS = require('aws-sdk');
const { promisify } = require('util');
const redis = require('redis');
const { Client } = require('pg');
const constants = require('/opt/nodejs/constants');

const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);
const zrem = promisify(redisPresence.zrem).bind(redisPresence);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);

const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

exports.handler = async function(event) {
    let userId;
    try {
        userId = await hget(
            constants.REDIS_KEY_CONNECTION_USER, event.requestContext.connectionId
        );
        await hdel(constants.REDIS_KEY_USER_CONNECTION, userId);
        await hdel(
            constants.REDIS_KEY_CONNECTION_USER, event.requestContext.connectionId
        );
        await hdel(constants.REDIS_KEY_PAGE, userId);
        await hdel(constants.REDIS_KEY_LATEST_PAGE, userId);
        await zrem(constants.REDIS_KEY_STATUS, userId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    // send disconnection message to friends
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

    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: process.env.WSS_DOMAIN_NAME.replace('wss://', '') + '/' + process.env.WSS_STAGE
    });
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

    await client.end();

    // save CLOSE_CONNECTION event to UserActivityHistoryTable
    try {
        const result = await dynamoDB.putItem({
            TableName: process.env.USER_ACTIVITY_HISTORY_TABLE_NAME,
            Item: {
                user_id: { S: userId },
                timestamp: { S: new Date(Date.now()).toISOString() },
                type: { S: "CLOSE_CONNECTION" }
            }
        }).promise();
        console.log(result);
    } catch (error) {
        console.log(error);
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ connectionId: event.requestContext.connectionId })
    };
};
