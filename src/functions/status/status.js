const redis = require('redis');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const redisPresenceEndpoint = process.env.REDIS_PRESENCE_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PRESENCE_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const zscore = promisify(redisPresence.zscore).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

/**
 * Status event handler
 * 
 * 1. Check `arguments.userId` from the event
 * 2. Calls zscore to check the presence of the id
 */
exports.handler = async function(event) {
    const userId = event && event.arguments && event.arguments.userId;
    if (userId === undefined || userId === null) {
        throw new Error("Missing argument 'id'");
    }

    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
        throw new Error("Authorization failed");
    }

    // TODO - use decodedJwt.payload.username to check friend relationship and throw error if not friend
    
    try {
        const status = await zscore("status", userId);
        const pageStr = await hget("page", userId);
        const page = JSON.parse(pageStr)

        return {
            userId: userId,
            status: status ? "online" : "offline",
            url: page.url,
            title: page.title
        };
    } catch (error) {
        return error;
    }
}