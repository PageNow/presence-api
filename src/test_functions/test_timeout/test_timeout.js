const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const constants = require('/opt/nodejs/constants');

const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'locahost';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

exports.handler = async function(event) {
    const userId = event && event.userId;
    if (userId === undefined || userId === null) {
        throw new Error("Missing argument 'userId'");
    }
    const domainName = event && event.domainName;
    if (domainName === undefined || domainName === null) {
        throw new Error("Missing argument 'domainName'");
    }
    const stage = event && event.stage;
    if (stage === undefined || stage === null) {
        throw new Error("Missing argument 'stage'");
    }

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
        let connectionIdArr = await hmget(
            constants.REDIS_KEY_USER_CONNECTION, friendIdArr
        );
        connectionDataArr = connectionIdArr.map((x, i) => {
            return { friendId: friendIdArr[i], connectionId: x };
        }).filter(x => x.connectionId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }

    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: domainName + '/' + stage
    });
    const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
        console.log('postCall connectionId', connectionId);
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
    await client.end();

    return { statusCode: 200, body: 'Data sent' };
}