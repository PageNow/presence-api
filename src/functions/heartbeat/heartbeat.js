const redis = require('redis');
const { promisify } = require('util');
const constants = require('/opt/nodejs/constants');

// Redis connection variables
const redisPresenceEndpoint = process.env.REDIS_PRIMARY_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRIMARY_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);

// promisified Redis commands
const zadd = promisify(redisPresence.zadd).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

exports.handler = async function(event) {
    // get user id using the connection id
    const userId = await hget(
        constants.REDIS_KEY_CONNECTION_USER, event.requestContext.connectionId
    );
    if (userId == null || userId == undefined) {
        return { statusCode: 500, body: 'Authentication error' };
    }
    console.log('connection userId', userId);

    // add/update the score of userId to the current timestamp for "status" Redis key    
    try {
        await zadd(constants.REDIS_KEY_STATUS, Date.now(), userId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }    
    return { statusCode: 200, body: 'Data sent' };
};
