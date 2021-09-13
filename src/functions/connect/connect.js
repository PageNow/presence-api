const { promisify } = require('util');
const redis = require('redis');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hset = promisify(redisPresence.hset).bind(redisPresence);

let cacheKeys;

exports.handler = async function(event) {
    let userId;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        userId = await decodeVerifyJwt(event.queryStringParameters.Authorization, cacheKeys);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }
    console.log(userId);

    // update connectId
    try {
        await hset("connection", userId, event.requestContext.connectionId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }
   
    return { 
        statusCode: 200, 
        body: JSON.stringify({ connectionId: event.requestContext.connectionId })
    };
}
