const { promisify } = require('util');
import * as mockRedis from 'redis-mock';
import * as heartbeat from '../../src/functions/heartbeat/heartbeat';
jest.mock('redis', () => mockRedis);

const data = {
    connection1: "1",
    user1: "user1",
    user2: "user2"
};

describe("AWS Lambda function - heartbeat", () => {
    const redisClient = mockRedis.createClient();
    const hset = promisify(redisClient.hset).bind(redisClient);;
    const zscore = promisify(redisClient.zscore).bind(redisClient);;

    beforeAll(async () => {
        await hset("presence_connection_user", data.connection1, data.user1);
    });

    it('exports a handler function', () => {
        expect(heartbeat).toHaveProperty('handler');
        expect(typeof heartbeat.handler).toBe("function");
    });

    it('should return authentication error', async () => {
        const authErrorResponse = {
            statusCode: 500,
            body: 'Authentication error'
        };
        const event = {
            requestContext: {
                connectionId: "2"
            }
        };
        await expect(heartbeat.handler(event)).resolves.toMatchObject(authErrorResponse);
    });

    it('should execute heartbeat', async () => {
        const event = {
            requestContext: {
                connectionId: data.connection1
            }
        };
        expect(zscore("status", data.user1)).resolves.toBe(null);
        await expect(heartbeat.handler(event)).resolves
            .toMatchObject({ statusCode: 200, body: 'Data sent' });

        // confirm that heartbeat updates user's status score in Redis
        await expect(zscore("status", data.user2)).resolves.toBe(null);
        const result = await zscore("status", data.user1);
        expect(result).not.toBe(null);
    });

    it('should update status via heartbeat', async () => {
        const event = {
            requestContext: {
                connectionId: data.connection1
            }
        };
        await heartbeat.handler(event);
        let result = await zscore("status", data.user1);
        const stamp1 = parseInt(result, 10);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await heartbeat.handler(event);
        result = await zscore("status", data.user1);
        const stamp2 = parseInt(result, 10);

        // confirm that heartbeat updates the status score
        expect(stamp2).toBeGreaterThan(stamp1);
    });
});
