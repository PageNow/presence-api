const AWS = require('aws-sdk');
const redis = require('redis');
const { promisify } = require('util');

const timeout = parseInt(process.env.TIMEOUT, 10);
const eventBus = process.env.EVENT_BUS;

const redisPresenceEndpoint = process.env.REDIS_HOST || 'locahost';
const redisPresencePort = process.env.REDIS_PORT || 6379;
const redisPresence = redis.createClient(redisPresencePort, redisPresenceEndpoint);
const eventBridge = new AWS.EventBridge();

/**
 * Timeout handler
 * 
 * 1. Use `multi` to chain Redis commands
 * 2. Commands are zrangebyscore to retrieve expired id, zremrangebyscore to remove them
 * 3. Send events for ids
 */
exports.handler = async function() {
    const timestamp = Date.now() - timeout;
    const commands = redisPresence.multi();
    commands.zrangebyscore("presence", "-inf", timestamp);
    commands.zremrangebyscore("presence", "-inf", timestamp);
    const execute = promisify(commands.exec).bind(commands);
    try {
        // Multiple commands results are returned as an array of result, one entry per command
        // `ids` is the result of the first command
        const [userIds] = await execute();
        if (!userIds.length) return { expired: 0 };

        // putEvents is limited to 10 events per call
        // Create a promise for each batch of ten events ...
        let promises = [];
        while (userIds.length) {
            const Entries = ids.splice(0, 10).map(userId => {
                return {
                    Detail: JSON.stringify({ userId }),
                    DetailType: "presence.disconnected",
                    Source: "api.presence",
                    EventBusName: eventBus,
                    Time: Date.now()
                };
            });
            promises.push(eventBridge.putEvents({ Entries }).promise());
        }
        // ... and await for all promises to return
        const results = await Promise.all(promises);
        // Sum results for all promises and return
        const failed = results.reduce(
            (sum, result) => sum + result.FailedEntryCount,
            0
        );
        const expired = results.reduce(
            (sum, result) => sum + (result.Entries.length - result.FailedEntryCount),
            0
        );
        return { expired, failed };
    } catch (error) {
        return error;
    }
}
