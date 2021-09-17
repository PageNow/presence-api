const redis = require('redis');
const { promisify } = require('util');
const _ = require('lodash');
const { Client } = require('pg');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hmget = promisify(redisPresence.hmget).bind(redisPresence);
const zrange = promisify(redisPresence.zrange).bind(redisPresence);

let cacheKeys;

exports.handler = async function(event) {
    console.log(event);
    let userId, decodedJwt;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        decodedJwt = await decodeVerifyJwt(event.request.headers.authorization, cacheKeys);
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }
    if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
        return { statusCode: 500, body: 'Authentication error' };
    }
    console.log(userId);

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
        friendIdArr.push(userId);
    } catch (error) {
        await client.end();
        console.log(error);
        return { statusCode: 500, body: 'Database error: ' + JSON.stringify(error) };
    }
    await client.end();
    console.log(friendIdArr);
    
    let pageArr = [];
    try {
        pageArr = await hmget("page", friendIdArr);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }
    if (pageArr.length !== friendIdArr.length) {
        return { statusCode: 500, body: 'Redis error' };
    }

    const presence = {};
    friendIdArr.forEach((key, i) => {
        if (pageArr[i] == undefined || pageArr[i] == null) {
            presence[key] = null;
        } else {
            presence[key] = JSON.parse(pageArr[i]);
        }
    });

    return { statusCode: 200, body: { presence } };
};
