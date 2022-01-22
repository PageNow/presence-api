const { promisify } = require('util');
import * as mockRedis from 'redis-mock';

import * as heartbeat from '../../src/functions/heartbeat/heartbeat';
import * as data from '../utils/data';

// mock Redis
jest.mock('redis', () => mockRedis);

describe("AWS Lambda function - heartbeat", () => {
    const redisClient = mockRedis.createClient();
    const hset = promisify(redisClient.hset).bind(redisClient);
    const zscore = promisify(redisClient.zscore).bind(redisClient);
    
    const event = {
        requestContext: {
            connectionId: data.CONNECTION_ID1
        }
    };

    beforeAll(async () => {
        // set Redis data to make user online
        await hset("presence_connection_user", data.CONNECTION_ID1, data.USER_ID1);
    });

    it('should export a handler function', () => {
        expect(heartbeat).toHaveProperty('handler');
        expect(typeof heartbeat.handler).toBe("function");
    });

    it('should return authentication error', async () => {
        const authErrorResponse = {
            statusCode: 500,
            body: 'Authentication error'
        };
        const errorEvent = {
            requestContext: {
                connectionId: data.CONNECTION_ID2
            }
        };
        await expect(heartbeat.handler(errorEvent)).resolves.toMatchObject(authErrorResponse);
    });

    it('should execute heartbeat', async () => {
        expect(zscore("status", data.USER_ID1)).resolves.toBeNull();
        await expect(heartbeat.handler(event)).resolves
            .toMatchObject({ statusCode: 200, body: 'Data sent' });

        // confirm that heartbeat updates user's status score in Redis
        await expect(zscore("status", data.USER_ID2)).resolves.toBeNull();
        const result = await zscore("status", data.USER_ID1);
        expect(result).not.toBeNull();
    });

    it('should update status via heartbeat', async () => {
        // execute heartbeat
        await heartbeat.handler(event);
        let result = await zscore("status", data.USER_ID1);
        const stamp1 = parseInt(result, 10);

        // wait a second and execute heartbeat again
        await new Promise(resolve => setTimeout(resolve, 1000));
        await heartbeat.handler(event);
        result = await zscore("status", data.USER_ID1);
        const stamp2 = parseInt(result, 10);

        // confirm that the heartbeat updates the status score
        expect(stamp2).toBeGreaterThan(stamp1);
    });
});
