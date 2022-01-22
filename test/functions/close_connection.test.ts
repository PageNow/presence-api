const { promisify } = require('util');
const { Client } = require('pg');
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as close_connection from '../../src/functions/close_connection/close_connection';
import * as constants from '../../src/layer/nodejs/constants';
import * as config from '../utils/config';
import * as data from '../utils/data';
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

    const event = {
        requestContext: {
            connectionId: data.CONNECTION_ID1
        }
    };

    let pgClient;

    beforeAll(async () => {
        process.env = {
            DB_USER: config.POSTGRES_CONFIG.user,
            DB_HOST: config.POSTGRES_CONFIG.host,
            DB_DATABASE: config.POSTGRES_CONFIG.database,
            DB_PASSWORD: config.POSTGRES_CONFIG.password,
            DB_SSL: config.POSTGRES_CONFIG.ssl,
            WSS_DOMAIN_NAME: `wss://${config.WSS_CONFIG.wssDomain}`,
            WSS_STAGE: config.WSS_CONFIG.wssStage,
            USER_ACTIVITY_HISTORY_TABLE_NAME: config.DYNAMO_DB_CONFIG.userActivityHistoryTable
        };

        // connect to PostgreSQL client
        pgClient = new Client({
            host: config.POSTGRES_CONFIG.host,
            user: config.POSTGRES_CONFIG.user,
            database: config.POSTGRES_CONFIG.database,
            password: config.POSTGRES_CONFIG.password,
            port: config.POSTGRES_CONFIG.port
        });
        await pgClient.connect();

        // create PostgreSQL friendship_table
        await pgClient.query(FRIENDSHIP_TABLE_CREATE_SQL);
    
        // add friendship data
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9)
        `;
        const values = [
            data.USER_ID1, data.USER_ID2, new Date(),
            data.USER_ID3, data.USER_ID1, new Date(),
            data.USER_ID4, data.USER_ID1, new Date()
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // Redis data for user 1
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1, data.USER_ID1);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1, data.CONNECTION_ID1);
        await hset(constants.REDIS_KEY_PAGE, data.USER_ID1, JSON.stringify(data.SHARED_PAGE1));
        await hset(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1, JSON.stringify(data.LATEST_PAGE1));
        await zadd(constants.REDIS_KEY_STATUS, mockData.status, data.USER_ID1);

        // Redis data for user 2 - online
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID2, data.USER_ID2);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID2, data.CONNECTION_ID2);

        // Redis data for user 3 - online
        await hset(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID3, data.USER_ID3);
        await hset(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID3, data.CONNECTION_ID3);
    });

    afterAll(async () => {
        // drop table after all the tests finish running
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
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1)).resolves.toBe(data.USER_ID1);
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1)).resolves.toBe(data.CONNECTION_ID1);
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.SHARED_PAGE1));
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBe(JSON.stringify(data.LATEST_PAGE1));
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID1)).resolves.toBe(mockData.status.toString());

        await close_connection.handler(event); // execute handler

        // confirm that close_connection removes user data from Redis
        await expect(hget(constants.REDIS_KEY_CONNECTION_USER, data.CONNECTION_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_USER_CONNECTION, data.USER_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_PAGE, data.USER_ID1)).resolves.toBeNull();
        await expect(hget(constants.REDIS_KEY_LATEST_PAGE, data.USER_ID1)).resolves.toBeNull();
        await expect(zscore(constants.REDIS_KEY_STATUS, data.USER_ID1)).resolves.toBeNull();
    });

    it('should send message to connected clients', async () => {
        await close_connection.handler(event); // execute handler

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${config.WSS_CONFIG.wssDomain}/${config.WSS_CONFIG.wssStage}`
        });

        // confirm that close_connection data is posted to connected friends
        expect(mockPostToConnection).toHaveBeenCalledTimes(2);
        expect(mockPostToConnection).toHaveBeenNthCalledWith(1, {
            ConnectionId: data.CONNECTION_ID2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.USER_ID1
            })
        });
        expect(mockPostToConnection).toHaveBeenNthCalledWith(2, {
            ConnectionId: data.CONNECTION_ID3,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: data.USER_ID1
            })
        });
    });

    it('should save CLOSE_CONNECTION event to DynamoDB', async () => {
        await close_connection.handler(event); // execute handler

        // confirm that user's CLOSE_CONNECTION activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(1);
        expect(mockPutItem).toHaveBeenCalledWith({
            TableName: config.DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: data.USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "CLOSE_CONNECTION" }
            }
        });
    });
});
