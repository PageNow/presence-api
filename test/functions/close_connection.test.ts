const { promisify } = require('util');
const { Client } = require('pg');
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as close_connection from '../../src/functions/close_connection/close_connection';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER, REDIS_KEY_PAGE,
    REDIS_KEY_LATEST_PAGE, REDIS_KEY_STATUS
} from '../../src/layer/nodejs/constants';
import { WSS_CONFIG, POSTGRES_CONFIG, DYNAMO_DB_CONFIG } from '../utils/config';
import {
    USER_ID1, USER_ID2, USER_ID3, CONNECTION_ID1, CONNECTION_ID2, CONNECTION_ID3,
    SHARED_PAGE1, LATEST_PAGE1
} from '../utils/data';
import { FRIENDSHIP_TABLE_CREATE_SQL } from '../utils/sql';

// mock Redis
jest.mock('redis', () => mockRedis);

// mock AWS services
const mockPutItem = jest.fn(() => {
    return {
        promise: jest.fn(() => "AWS.DynamoDB.putItem() called")
    };
});
const mockPostToConnection = jest.fn(() => {
    return {
        promise: jest.fn(() => "AWS.ApiGatewayManagementApi.postToConnection() called")
    };
});
jest.mock('aws-sdk', () => {
    return {
        DynamoDB: jest.fn().mockImplementation(() => {
            return {
                putItem: mockPutItem
            };
        }),
        ApiGatewayManagementApi: jest.fn().mockImplementation(() => {
            return {
                postToConnection: mockPostToConnection
            };
        })
    }
});

// mock data
const mockData = {
    status: Date.now()
};

describe("AWS Lambda function - close_connection", () => {
    // setup Redis commands
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);
    const hset = promisify(redisClient.hset).bind(redisClient);
    const zadd = promisify(redisClient.zadd).bind(redisClient);
    const zscore = promisify(redisClient.zscore).bind(redisClient);

    let pgClient;

    beforeAll(async () => {
        process.env = {
            DB_USER: POSTGRES_CONFIG.user,
            DB_HOST: POSTGRES_CONFIG.host,
            DB_DATABASE: POSTGRES_CONFIG.database,
            DB_PASSWORD: POSTGRES_CONFIG.password,
            DB_SSL: POSTGRES_CONFIG.ssl,
            WSS_DOMAIN_NAME: `wss://${WSS_CONFIG.wssDomain}`,
            WSS_STAGE: WSS_CONFIG.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: DYNAMO_DB_CONFIG.userActivityHistoryTable
        };

        // connect to PostgreSQL client
        pgClient = new Client({
            host: POSTGRES_CONFIG.host,
            user: POSTGRES_CONFIG.user,
            database: POSTGRES_CONFIG.database,
            password: POSTGRES_CONFIG.password,
            port: POSTGRES_CONFIG.port
        });
        await pgClient.connect();

        // create PostgreSQL friendship_table
        await pgClient.query(FRIENDSHIP_TABLE_CREATE_SQL);
    
        // add friendship data
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6)
        `;
        const values = [
            USER_ID1, USER_ID2, new Date(),
            USER_ID3, USER_ID1, new Date(),
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // Redis data for user 1
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1, USER_ID1);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID1, CONNECTION_ID1);
        await hset(REDIS_KEY_PAGE, USER_ID1, JSON.stringify(SHARED_PAGE1));
        await hset(REDIS_KEY_LATEST_PAGE, USER_ID1, JSON.stringify(LATEST_PAGE1));
        await zadd(REDIS_KEY_STATUS, mockData.status, USER_ID1);

        // Redis data for user 2
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID2, USER_ID2);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID2, CONNECTION_ID2);

        // Redis data for user 3
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID3, USER_ID3);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID3, CONNECTION_ID3);
    });

    afterAll(async () => {
        // drop table
        const text = 'DROP TABLE friendship_table';
        await pgClient.query(text);
        await pgClient.end();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should export a handler function', () => {
        expect(close_connection).toHaveProperty('handler');
        expect(typeof close_connection.handler).toBe('function');
    });

    it('should remove user data from Redis', async () => {
        // verify that Redis data is there
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1)).resolves.toBe(USER_ID1);
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID1)).resolves.toBe(CONNECTION_ID1);
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(JSON.stringify(LATEST_PAGE1));
        await expect(zscore(REDIS_KEY_STATUS, USER_ID1)).resolves.toBe(mockData.status.toString());

        const event = {
            requestContext: {
                connectionId: CONNECTION_ID1
            }
        };
        await close_connection.handler(event);

        // confirm that close_connection removes user data from Redis
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBe(null);
        await expect(zscore(REDIS_KEY_STATUS, USER_ID1)).resolves.toBe(null);
    });

    it('should send message to connected clients', async () => {
        const event = {
            requestContext: {
                connectionId: CONNECTION_ID1
            }
        };
        await close_connection.handler(event);

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${WSS_CONFIG.wssDomain}/${WSS_CONFIG.wssStage}`
        });

        // confirm that close_connection data is posted to connected friends
        expect(mockPostToConnection).toHaveBeenCalledTimes(2);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: CONNECTION_ID2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: USER_ID1
            })
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: CONNECTION_ID3,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: USER_ID1
            })
        });
    });

    it('should save CLOSE_CONNECTION event to DynamoDB', async () => {
        const event = {
            requestContext: {
                connectionId: CONNECTION_ID1
            }
        };
        await close_connection.handler(event);

        // confirm that user's CLOSE_CONNECTION activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenCalledWith({
            TableName: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "CLOSE_CONNECTION" }
            }
        });
    });
});
