const { promisify } = require('util');
import * as mockRedis from 'redis-mock';

import * as connect from '../../src/functions/connect/connect';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER
} from '../../src/layer/nodejs/constants';

// mock Redis
jest.mock('redis', () => mockRedis);

// mock DynamoDB
const mockPutItem = jest.fn(() => {
    return {
        promise: jest.fn(() => 'DyanmoDB.putItem() called')
    };
});
jest.mock('aws-sdk', () => {
    const DynamoDB = jest.fn().mockImplementation(() => {
        return {
            putItem: mockPutItem
        };
    });
    return {
        DynamoDB,
    };
});

const data = {
    decodedJwt: {
        username: 'user1',
        isValid: true
    },
    userId: 'user1',
    connectionId: 'connection1'
};

const config = {
    userActivityHistoryTable: 'UserActivityHistoryTable'
}

describe("AWS Lambda function - connect", () => {
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);

    beforeAll(async () => {
        process.env = {
            USER_ACTIVITY_HISTORY_TABLE_NAME: config.userActivityHistoryTable
        };
    });

    afterEach(() => {    
        jest.clearAllMocks();
    });

    it('exports a handler function', () => {
        expect(connect).toHaveProperty('handler');
        expect(typeof connect.handler).toBe('function');
    });

    it('should set connection data to Redis', async () => {
        const event = {
            requestContext: {
                connectionId: data.connectionId
            },
            queryStringParameters: {
                Authorization: JSON.stringify(data.decodedJwt)
            }
        };
        expect(hget(REDIS_KEY_USER_CONNECTION, data.userId)).resolves.toBe(null);
        expect(hget(REDIS_KEY_CONNECTION_USER, data.connectionId)).resolves.toBe(null);
        await expect(connect.handler(event)).resolves
            .toMatchObject({ 
                statusCode: 200,
                body: JSON.stringify({ connectionId: data.connectionId})
            });
        const expectedConnectionId = await hget(REDIS_KEY_USER_CONNECTION, data.userId);
        const expectedUserId = await hget(REDIS_KEY_CONNECTION_USER, data.connectionId);
        expect(expectedUserId).toBe(data.userId);
        expect(expectedConnectionId).toBe(data.connectionId);
    });

    it('should save to DynamoDB', async () => {
        const event = {
            requestContext: {
                connectionId: data.connectionId
            },
            queryStringParameters: {
                Authorization: JSON.stringify(data.decodedJwt)
            }
        };

        await connect.handler(event);

        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenLastCalledWith({
            TableName: config.userActivityHistoryTable,
            Item: {
                user_id: { S: data.userId },
                timestamp: { S: expect.anything() },
                type: { S: 'CONNECT' }
            }
        })
    });
});
