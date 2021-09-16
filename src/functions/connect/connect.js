const { promisify } = require('util');
const redis = require('redis');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

let cacheKeys;

exports.handler = async function(event) {
    console.log(event.requestContext);
    let userId, decodedJwt;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        decodedJwt = await decodeVerifyJwt(event.queryStringParameters.Authorization, cacheKeys);
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }

    if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
        return { statusCode: 500, body: 'Authentication error' };
    }

    // update connectId
    try {
        const commands = redisPresence.multi();
        commands.hset("user_connection", userId, event.requestContext.connectionId);
        commands.hset("connection_user", event.requestContext.connectionId, userId);
        const execute = promisify(commands.exec).bind(commands);
        await execute();
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }
   
    return { 
        statusCode: 200, 
        body: JSON.stringify({ connectionId: event.requestContext.connectionId })
    };
};
