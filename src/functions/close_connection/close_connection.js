const { promisify } = require('util');
const redis = require('redis');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

exports.handler = async function(event) {
    try {
        const userId = await hget("presence_connection_user", event.requestContext.connectionId);
        await hdel("presence_user_connection", userId);
        await hdel("presence_connection_user", event.requestContext.connectionId)
        await hdel('status', userId);
    } catch (error) {
        console.log(error);
        return { statusCode: 500, body: 'Redis error: ' + JSON.stringify(error) };
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ connectionId: event.requestContext.connectionId })
    }
};
