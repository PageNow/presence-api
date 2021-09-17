const redis = require('redis');
const { promisify } = require('util');
const { getPublicKeys, decodeVerifyJwt } = require('/opt/nodejs/decode-verify-jwt');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const zadd = promisify(redisPresence.zadd).bind(redisPresence);

let cacheKeys;

exports.handler = async function(event) {
    if (eventData.jwt == undefined || eventData.jwt == null) {
        throw new Error("Missing 'jwt' in the event body");
    }

    let userId;
    try {
        if (!cacheKeys) {
            cacheKeys = await getPublicKeys();
        }
        const decodedJwt = await decodeVerifyJwt(event.queryStringParameters.Authorization, cacheKeys);
        if (!decodedJwt || !decodedJwt.isValid || decodedJwt.username === '') {
            return { statusCode: 500, body: 'Authentication error' };
        }
        userId = decodedJwt.username;
    } catch (error) {
        return { statusCode: 500, body: 'JWT decode error: ' + JSON.stringify(error) };
    }
    
    try {
        await zadd('status', Date.now(), userId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }    
    return { statusCode: 200, body: 'Data sent' };
};
