const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');

const redisEndpoint = process.env.REDIS_HOST || 'locahost';
const redisPort = process.env.REDIS_PORT || 6379;
const presence = redis.createClient(redisPort, redisEndpoint);
const zadd = promisify(presence.zadd).bind(presence);
const eventBridge = new AWS.EventBridge();
const eventBus = process.env.EVENT_BUS;

/**
 * Hearbeat handler:
 * 
 * 1. Check `arguments.id` from the event
 * 2. Use zadd to add or update the timestamp
 * 3. If the timestamp was added, send a connection event
 */
exports.handler = async function(event) {
    const id = event && event.arguments && event.arguments.id;
    if (id === undefined || id === null) {
        throw new Error("Missing argument 'id'");
    }
    try {
        const result = await zadd("presence", Date.now(), id);
        if (result === 1)  { // New connection
            await eventBridge.putEvents({
                Entries: [{
                    Detail: JSON.stringify({ id }),
                    DetailType: "presence.connected",
                    Source: "api.presence",
                    EventBusName: eventBus,
                    Time: Date.now()
                }]
            }).promise();
        }
    } catch (error) {
        return error;
    }
    return { id: id, status: "online" };
}
