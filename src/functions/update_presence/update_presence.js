const { promisify } = require('util');
const AWS = require('aws-sdk');
const redis = require('redis');
const jwt = require('jsonwebtoken');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hset = promisify(redisPresence.hset).bind(redisPresence);

exports.handler = async function(event) {
    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
        throw new Error("Authorization failed");
    }
    const userId = decodedJwt.payload['cognito:username'];

    // get a list of friends

    // get the connection ids of friends

    // post to connections

    // update REDIS

    try {
        await hset("connection", userId, event.requestContext.connectionId)
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Failed to connect: ' + JSON.stringify(err) };
    }
    return { statusCode: 200, body: JSON.stringify({ connectionId: event.requestContext.connectionId }) };
}
