const redis = require('redis');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const redisEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPort = process.env.REDIS_PORT || 6379;

const presence = redis.createClient(redisPort, redisEndpoint);
const zscore = promisify(presence.zscore).bind(presence);

/**
 * Status event handler
 * 
 * 1. Check `arguments.id` from the event
 * 2. Calls zscore to check the presence of the id
 */
exports.handler = async function(event) {
    const id = event && event.arguments && event.arguments.id;
    if (id === undefined || id === null) {
        throw new Error("Missing argument 'id'");
    }
    // TODO: add some checks
    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    try {
        const result = await zscore("presence", id);
        return { id: decodedJwt.payload.username, status: result ? "online" : "offline" };
    } catch (error) {
        return error;
    }
}