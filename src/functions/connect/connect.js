const { promisify } = require('util');
const AWS = require('aws-sdk');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hset = promisify(redisPresence.hset).bind(redisPresence);

exports.handler = async function(event) {
    const client = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_RW_HOST,
        database: process.env.DB_DATABASE,
        password: process.env.DB_PASSWORD,
        port: parseInt(process.env.DB_PORT) || 5432,
        ssl: true
    });
    try {
        await client.connect();
    } catch (err) {
        console.log(err);
        throw new Error(err);
    }
    
    // console.log(event.requestContext.connectId);
    let result;
    try {
        result = await client.query('SELECT * FROM user_info');
        console.log(result.rows);
    } catch (err) {
        console.log(err);
        await client.end();
        throw new Error(err);
    }
    await client.end();

    // const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    // if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
    //     throw new Error("Authorization failed");
    // }
    // const userId = decodedJwt.payload['cognito:username'];

    // try {
    //     await hset("connection", userId, event.requestContext.connectionId)
    // } catch (error) {
    //     console.log(error);
    //     return { statusCode: 500, body: 'Failed to connect: ' + JSON.stringify(err) };
    // }
    // return { statusCode: 200, body: JSON.stringify({ connectionId: event.requestContext.connectionId }) };
}
