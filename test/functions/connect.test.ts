const { promisify } = require('util');
import * as mockRedis from 'redis-mock';

import * as connect from '../../src/functions/connect/connect';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER
} from '../../src/layer/nodejs/constants';
import { DYNAMO_DB_CONFIG } from '../utils/config';
import { USER_ID1, CONNECTION_ID1 } from '../utils/data';

// mock Redis
jest.mock('redis', () => mockRedis);

// mock AWS DynamoDB
const mockPutItem = jest.fn(() => {
    return {
        promise: jest.fn(() => 'AWS.DyanmoDB.putItem() called')
    };
});
jest.mock('aws-sdk', () => {
    return {
        DynamoDB: jest.fn().mockImplementation(() => {
            return {
                putItem: mockPutItem
            };
        })
    }
});

const decodedJwt = {
    username: USER_ID1,
    isValid: true
};

describe("AWS Lambda function - connect", () => {
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);

    // event data passed to the handler
    const event = {
        requestContext: {
            connectionId: CONNECTION_ID1
        },
        queryStringParameters: {
            Authorization: JSON.stringify(decodedJwt)
        }
    };

    beforeAll(async () => {
        // set environment variable
        process.env = {
            USER_ACTIVITY_HISTORY_TABLE_NAME: DYNAMO_DB_CONFIG.userActivityHistoryTable
        };
    });

    afterEach(() => {    
        jest.clearAllMocks();
    });

    it('should export a handler function', () => {
        expect(connect).toHaveProperty('handler');
        expect(typeof connect.handler).toBe('function');
    });

    it('should set connection data to Redis', async () => {
        // verify that connection data in Redis is null before the handler is called
        expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID1)).resolves.toBeNull();
        expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1)).resolves.toBeNull();
        // execute connect handler
        await connect.handler(event);

        // confirm that connection data is set property to Redis
        const expectedConnectionId = await hget(REDIS_KEY_USER_CONNECTION, USER_ID1);
        const expectedUserId = await hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1);
        expect(expectedUserId).toBe(USER_ID1);
        expect(expectedConnectionId).toBe(CONNECTION_ID1);
    });

    it('should save CONNECT event to DynamoDB', async () => {
        await connect.handler(event); // execute connect handler

        // confirm that user's CONNECT activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenLastCalledWith({
            TableName: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: 'CONNECT' }
            }
        });
    });
});
