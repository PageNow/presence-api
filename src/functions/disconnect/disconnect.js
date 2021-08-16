const { promisify } = require('util');
const AWS = require('aws-sdk');
const eventBridge = new AWS.EventBridge();
const jwt = require('jsonwebtoken');

const redis = require('redis');
const eventBus = process.env.EVENT_BUS;
const redisPresenceEndpoint = process.env.REDIS_HOST || 'host.docker.internal';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const zrem = promisify(redisPresence.zrem).bind(redisPresence);
const hdel = promisify(redisPresence.hdel).bind(redisPresence);

/**
 * Disconnect handler
 * 
 * 1. Check `arguments.id` from the event
 * 2. Calls `zrem` to remove the timestamp from the database
 * 3. Send an event if the id was still online.
 */
exports.handler = async function(event) {
    const decodedJwt = jwt.decode(event.request.headers.authorization, { complete: true });
    if (decodedJwt.payload.iss !== 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_014HGnyeu') {
        throw new Error("Authorization failed");
    }
    console.log(decodedJwt);
    const userId = decodedJwt.payload['cognito:username'];

    try {
        const removals = await zrem("status", userId);
        await hdel("page", userId);
        if (removals != 1) { // if id is already removed, then bypass event
            return { userId, url: "", title: "", status: "offline" };
        }
        const Entries = [
            {
                Detail: JSON.stringify({ userId }),
                DetailType: "presence.disconnected",
                Source: "api.presence",
                EventBusName: eventBus,
                Time: Date.now()
            }
        ];
        await eventBridge.putEvents({ Entries }).promise();
        return { userId, url: "", title: "", status: "offline" };
    } catch (error) {
        console.log(error);
        return error;
    }
}
