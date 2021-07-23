const redis = require('redis');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const zscore = promisify(redisPresence.zscore).bind(redisPresence);
const hget = promisify(redisPresence.hget).bind(redisPresence);

/**
 * Status event handler
 * 
 * 1. Check `arguments.userId` from the event
 * 2. Calls zscore to check the presence of the id
 * 3. Calls hget to get the page info of the id
 */
exports.handler = async function(event) {
    const userId = event && event.arguments && event.arguments.userId;
    if (userId === undefined || userId === null) {
        throw new Error("Missing argument 'userId'");
    }

    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
        throw new Error("Authorization failed");
    }

    // TODO - use decodedJwt.payload.username to check friend relationship and throw error if not friend
    
    try {
        const status = await zscore("status", userId);
        const pageStr = await hget("page", userId);
        let url = '', title = '';
        if (pageStr) {
            const page = JSON.parse(pageStr);
            url = page.url;
            title = page.title;
        }

        return {
            userId: userId,
            status: status ? "online" : "offline",
            url: status ? url : "",
            title: status ? title: ""
        };
    } catch (error) {
        console.log(error);
        return error;
    }
}