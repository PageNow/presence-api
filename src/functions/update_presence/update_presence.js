const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');
const { Client } = require('pg');
const psl = require('psl');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

let cacheKeys;
const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

exports.handler = async function(event) {
    const eventData = JSON.parse(event.body);
    console.log('eventData', eventData);
    if (eventData.jwt == undefined || eventData.jwt == null) {
        throw new Error("Missing 'jwt' in the event body");
    }
    if (eventData.url == undefined || eventData.url == null) {
        throw new Error("Missing 'url' in the event body");
    }
    if (eventData.title == undefined || eventData.title == null) {
        throw new Error("Missing 'title' in the event body");
    }

    let userId;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        const decodedJwt = await decodeVerifyJwt(eventData.jwt, cacheKeys);
        if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
            return { statusCode: 500, body: 'Authentication error' };
        }
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }
    const url = eventData.url;
    const title = eventData.title;
    let domain = '';
    if (url !== '') {
        try {
            const urlObj = new URL(url);
            const parsed = psl.parse(urlObj.hostname);
            domain = parsed.domain;
        } catch (error) {
            console.log(error);
        }
    }

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
        friendIdArr = result.rows.map(x => x.user_id1 === userId ? x.user_id2 : x.user_id1);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();
    console.log('friendIdArr', friendIdArr);

    // get connectionId of all friends
    let connectionDataArr = [];  // Array of object whose keys are friendId, connectionId
    try {
        const connectionIdArr = await hmget("presence_user_connection", friendIdArr);
        connectionDataArr = connectionIdArr.map((x, i) => {
            return { friendId: friendIdArr[i], connectionId: x };
        }).filter(x => x.connectionId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    connectionDataArr.push({ friendId: userId, connectionId: event.requestContext.connectionId });
    console.log('connectionDataArr', connectionDataArr);

    // post to all connections
    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
    });
    const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
        console.log(friendId);
        console.log(connectionId);
        try {
            await apigwManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    type: 'update-presence',
                    userId: userId,
                    url: url,
                    title: title,
                    domain: domain
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

    // save presence update to UserActivityHistoryTable
    try {
        const result = await dynamoDB.putItem({
            TableName: process.env.USER_ACTIVITY_HISTORY_TABLE_NAME,
            Item: {
                user_id: { S: userId },
                timestamp: { S: new Date(Date.now()).toISOString() },
                url: { S: url },
                title: { S: title }
            }
        }).promise();
        console.log(result);
    } catch(err) {
        console.log(err);
    }
    
    return { statusCode: 200, body: 'Data sent' };
};
