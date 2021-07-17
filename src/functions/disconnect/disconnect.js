const { promisify } = require('util');
const AWS = require('aws-sdk');
const eventBridge = new AWS.EventBridge();

const redis = require('redis');
const eventBus = process.env.EVENT_BUS;
const redisEndpoint = process.env.REDIS_HOST || 'locahost';
const redisPort = process.env.REDIS_PORT || 6379;
const presence = redis.createClient(redisPort, redisEndpoint);
const zrem = promisify(presence.zrem).bind(presence);

/**
 * Disconnect handler
 * 
 * 1. Check `arguments.id` from the event
 * 2. Calls `zrem` to remove the timestamp from the database
 * 3. Send an event if the id was still online.
 */
exports.handler = async function(event) {
    const id = event && event.arguments && event.arguments.id;
    if (id === undefined || id === null) {
        throw new Error("Missing argument 'id'");
    }
    try {
        const removals = await zrem("presence", id);
        if (removals != 1) { // if id is already removed, then bypass event
            return { id, status: "offline" };
        }
        const Entries = [
            {
                Detail: JSON.stringify({ id }),
                DetailType: "presence.disconnected",
                Source: "api.presence",
                EventBusName: eventBus,
                Time: Date.now()
            }
        ];
        await eventBridge.putEvents({ Entries }).promise();
        return { id, status: "offline" };
    } catch (error) {
        return error;
    }
}
