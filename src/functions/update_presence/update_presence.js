const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const psl = require('psl');
const constants = require('/opt/nodejs/constants');

// Redis connection variables
const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

// promisified Redis commands
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

exports.handler = async function(event) {
    const eventData = JSON.parse(event.body);
    // event body passed to the function must contain url and title
    if (eventData.url == undefined || eventData.url == null) {
        throw new Error("Missing 'url' in the event body");
    }
    if (eventData.title == undefined || eventData.title == null) {
        throw new Error("Missing 'title' in the event body");
    }

    // get user id using connection id
    const userId = await hget(
        constants.REDIS_KEY_CONNECTION_USER, event.requestContext.connectionId
    );
    if (userId == null || userId == undefined) {
        return { statusCode: 500, body: 'Authentication error' };
    }
    console.log('connection userId', userId);
    
    const url = eventData.url;
    const title = eventData.title;
    let domain = '';
    if (url !== '') {
        try {
            // parse domain from url
            const urlObj = new URL(url);
            const parsed = psl.parse(urlObj.hostname);
            domain = parsed.domain;
        } catch (error) {
            console.log(error);
        }
    }

    // update status and page on redis
    try {
        // add/update Redis data using transaction to keep consistency across keys
        const commands = redisPresence.multi();
        // update latest timestamp for the user
        commands.zadd(constants.REDIS_KEY_STATUS, Date.now(), userId);
        // update user activity data
        commands.hset(
            constants.REDIS_KEY_PAGE,
            userId, JSON.stringify({url: url, title: title})
        );
        // update latest shared activity only if url is not empty i.e. user allowed domain to be shared
        if (url !== '') {
            commands.hset(
                constants.REDIS_KEY_LATEST_PAGE,
                userId, JSON.stringify({url: url, title: title})
            );
        }
        const execute = promisify(commands.exec).bind(commands);
        await execute();
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    // connect to RDS PostgreSQL
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        ssl: process.env.DB_SSL !== 'false'
    });
    try {
        await client.connect();
    } catch (err) {
        console.log(err);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(err) };
    }

    // get a list of friends
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

    // array of object { friendId: friend id, connectionId: connection id }
    let connectionDataArr = [];
    try {
        if (friendIdArr.length > 0) {
            const connectionIdArr = await hmget(
                constants.REDIS_KEY_USER_CONNECTION, friendIdArr
            );
            connectionDataArr = connectionIdArr.map((x, i) => {
                return { friendId: friendIdArr[i], connectionId: x };
            }).filter(x => x.connectionId);
        }
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }
    connectionDataArr.push({ friendId: userId, connectionId: event.requestContext.connectionId });
    console.log('connectionDataArr', connectionDataArr);

    // get the latest presence info - guarantee that the data currently in Redis is sent to users
    let latestPresence = { url: '', title: '' };
    try {
        const latestPresenceStr = await hget(constants.REDIS_KEY_LATEST_PAGE, userId);
        if (latestPresenceStr) {
            latestPresence = JSON.parse(latestPresenceStr);
        }
    } catch (error) {
        console.log(error);
    }
    let latestDomain = '';
    if (latestPresence.url !== '') {
        try {
            const latestUrlObj = new URL(latestPresence.url);
            const parsed = psl.parse(latestUrlObj.hostname);
            latestDomain = parsed.domain;
        } catch (error) {
            console.log(error);
        }
    }

    // post to all connections
    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: event.requestContext.domainName + '/' + event.requestContext.stage
    });
    const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
        try {
            await apigwManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    type: 'update-presence',
                    userId: userId,
                    url: url,
                    title: title,
                    domain: domain,
                    latestUrl: latestPresence.url,
                    latestTitle: latestPresence.title,
                    latestDomain: latestDomain
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
        console.log(error);
        return { statusCode: 500, body: error.stack };
    }

    // save presence update to UserActivityHistoryTable
    const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    try {
        const result = await dynamoDB.putItem({
            TableName: process.env.USER_ACTIVITY_HISTORY_TABLE_NAME,
            Item: {
                user_id: { S: userId },
                timestamp: { S: new Date(Date.now()).toISOString() },
                type: { S: "UPDATE_PRESENCE" },
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
