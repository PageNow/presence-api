const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');
const { Client } = require('pg');
const psl = require('psl');
const constants = require('/opt/nodejs/constants');

const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

exports.handler = async function(event) {
    const userId = event && event.userId;
    if (userId === undefined || userId === null) {
        throw new Error("Missing argument 'userId'");
    }
    const url = event && event.url;
    if (url === undefined || url === null) {
        throw new Error("Missing argument 'url'");
    }
    let domain = '';
    try {
        if (url !== '') {
            const urlObj = new URL(url);
            const parsed = psl.parse(urlObj.hostname);
            domain = parsed.domain;
        }
    } catch (error) {
        console.log(error);
    }

    const title = event && event.title;
    if (title === undefined || title === null) {
        throw new Error("Missing argument 'title'");
    }
    const domainName = event && event.domainName;
    if (domainName === undefined || domainName === null) {
        throw new Error("Missing argument 'domainName'");
    }
    const stage = event && event.stage;
    if (stage === undefined || stage === null) {
        throw new Error("Missing argument 'stage'");
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
        console.log(result.rows);
        friendIdArr = result.rows.map(x => x.user_id1 === userId ? x.user_id2 : x.user_id1);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();
    friendIdArr.push(userId);

    try {
        const commands = redisPresence.multi();
        commands.zadd(constants.REDIS_KEY_STATUS, Date.now(), userId);
        commands.hset(
            constants.REDIS_KEY_PAGE,
            userId, JSON.stringify({url: url, title: title})
        );
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

    let connectionDataArr = [];  // Array of object whose keys are friendId, connectionId
    try {
        let connectionIdArr = await hmget(constants.REDIS_KEY_USER_CONNECTION, friendIdArr);
        connectionDataArr = connectionIdArr.map((x, i) => {
            return { friendId: friendIdArr[i], connectionId: x };
        }).filter(x => x.connectionId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    // get the latest presence info
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

    const apigwManagementApi = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: domainName + '/' + stage
    });
    // post to all connections
    const postCalls = connectionDataArr.map(async ({ friendId, connectionId }) => {
        try {
            await apigwManagementApi.postToConnection({
                ConnectionId: connectionId,
                Data: JSON.stringify({
                    type: 'update-presence',
                    userId, url, title, domain,
                    latestUrl: latestPresence.url,
                    latestTitle: latestPresence.title,
                    latestDomain: latestDomain
                })
            }).promise();
        } catch (error) {
            if (error.statusCode === 410) {
                console.log(`Found stale connection, deleting ${connectionId}`);
                await hdel(constants.REDIS_KEY_USER_CONNECTION, friendId);
                await hdel(constants.REDIS_KEY_CONNECTION_USER, connectionId);
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
