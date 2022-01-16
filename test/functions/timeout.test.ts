const { promisify } = require('util');
const { Client } = require('pg');
import * as AWS from 'aws-sdk';
import * as mockRedis from 'redis-mock';

import * as timeout from '../../src/functions/timeout/timeout';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER, REDIS_KEY_PAGE,
    REDIS_KEY_LATEST_PAGE, REDIS_KEY_STATUS
} from '../../src/layer/nodejs/constants';
import { WSS_CONFIG, POSTGRES_CONFIG, DYNAMO_DB_CONFIG } from '../utils/config';
import {
    USER_ID1, USER_ID2, USER_ID3, USER_ID4, USER_ID5, SHARED_PAGE1, LATEST_PAGE1,
    CONNECTION_ID1, CONNECTION_ID2, CONNECTION_ID3, CONNECTION_ID4, EMPTY_PAGE
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

const INACTIVE_TIME_DIFF = 240000;
const ACTIVE_TIME_DIFF = 100000;

describe("AWS Lambda function - timeout", () => {
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
            USER_ACTIVITY_HISTORY_TABLE_NAME: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            TIMEOUT: '180000'
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

        // add friendship: user1 <-> user2, user1 <-> user3, user4 <-> user2
        const text = `
            INSERT INTO friendship_table(user_id1, user_id2, accepted_at)
            VALUES
                ($1, $2, $3),
                ($4, $5, $6),
                ($7, $8, $9),
                ($10, $11, $12)
        `;
        const values = [
            USER_ID1, USER_ID2, new Date(),
            USER_ID3, USER_ID1, new Date(),
            USER_ID4, USER_ID2, new Date(),
            USER_ID5, USER_ID5, new Date()
        ];
        await pgClient.query(text, values);
    });

    beforeEach(async () => {
        // set Redis connection data for user 1
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1, USER_ID1);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID1, CONNECTION_ID1);
        await hset(REDIS_KEY_PAGE, USER_ID1, JSON.stringify(SHARED_PAGE1));
        await hset(REDIS_KEY_LATEST_PAGE, USER_ID1, JSON.stringify(LATEST_PAGE1));
        // set Redis connection data for user 2
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID2, USER_ID2);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID2, CONNECTION_ID2);
        await hset(REDIS_KEY_PAGE, USER_ID2, JSON.stringify(EMPTY_PAGE));
        await hset(REDIS_KEY_LATEST_PAGE, USER_ID2, JSON.stringify(LATEST_PAGE1));
        // set Redis connection data for user 3
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID3, USER_ID3);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID3, CONNECTION_ID3);
        await hset(REDIS_KEY_PAGE, USER_ID3, JSON.stringify(SHARED_PAGE1));
        await hset(REDIS_KEY_LATEST_PAGE, USER_ID3, JSON.stringify(LATEST_PAGE1));
        // set Redis connection data for user 4
        await hset(REDIS_KEY_CONNECTION_USER, CONNECTION_ID4, USER_ID4);
        await hset(REDIS_KEY_USER_CONNECTION, USER_ID4, CONNECTION_ID4);
        await hset(REDIS_KEY_PAGE, USER_ID4, JSON.stringify(EMPTY_PAGE));
        await hset(REDIS_KEY_LATEST_PAGE, USER_ID4, JSON.stringify(LATEST_PAGE1));
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
        expect(timeout).toHaveProperty('handler');
        expect(typeof timeout.handler).toBe('function');
    });

    it('should only remove users with stale timestamp', async () => {
        // user1 and user2 are inactive (stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID1);
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID2);
        // user3 and user4 are active (not stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID3);
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID4);

        await timeout.handler();

        // confirm that the user1 Redis data is removed
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID1)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID1)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_PAGE, USER_ID1)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID1)).resolves.toBeNull();
        await expect(zscore(REDIS_KEY_STATUS, USER_ID1)).resolves.toBeNull();

        // confirm that the user2 Redis data is removed
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID2)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID2)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_PAGE, USER_ID2)).resolves.toBeNull();
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID2)).resolves.toBeNull();
        await expect(zscore(REDIS_KEY_STATUS, USER_ID2)).resolves.toBeNull();

        // confirm that the user3 Redis data is not removed
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID3)).resolves.toBe(USER_ID3);
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID3)).resolves.toBe(CONNECTION_ID3);
        await expect(hget(REDIS_KEY_PAGE, USER_ID3)).resolves.toBe(JSON.stringify(SHARED_PAGE1));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID3)).resolves.toBe(JSON.stringify(LATEST_PAGE1));
        await expect(zscore(REDIS_KEY_STATUS, USER_ID3)).resolves.not.toBeNull();

        // confirm that the user4 Redis data is not removed
        await expect(hget(REDIS_KEY_CONNECTION_USER, CONNECTION_ID4)).resolves.toBe(USER_ID4);
        await expect(hget(REDIS_KEY_USER_CONNECTION, USER_ID4)).resolves.toBe(CONNECTION_ID4);
        await expect(hget(REDIS_KEY_PAGE, USER_ID4)).resolves.toBe(JSON.stringify(EMPTY_PAGE));
        await expect(hget(REDIS_KEY_LATEST_PAGE, USER_ID4)).resolves.toBe(JSON.stringify(LATEST_PAGE1));
        await expect(zscore(REDIS_KEY_STATUS, USER_ID4)).resolves.not.toBeNull();
    });

    it('should post messages to friends', async () => {
        // user1 times out => sends message to user2 and user3
        // user4 times out => sends message to user2 but not to user5 who is offline

        // user1 and user4 are inactive (stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID1);
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID4);
        // user2 and user3 are active (not stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID2);
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID3);

        await timeout.handler();

        // confirm that ApiGatewayManagementApi instance is created
        expect(AWS.ApiGatewayManagementApi).toHaveBeenCalledWith({
            apiVersion: "2018-11-29",
            endpoint: `${WSS_CONFIG.wssDomain}/${WSS_CONFIG.wssStage}`
        });

        // confirm that close_connection data is posted to connected friends
        expect(mockPostToConnection).toHaveBeenCalledTimes(3);
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
        expect(mockPostToConnection).toHaveBeenNthCalledWith(3, {
            ConnectionId: CONNECTION_ID2,
            Data: JSON.stringify({
                type: 'presence-timeout',
                userId: USER_ID4
            })
        });
    });

    it('should save TIMEOUT event to UserActivityHistoryTable', async () => {
        // user1 and user2 are inactive (stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID1);
        await zadd(REDIS_KEY_STATUS, Date.now() - INACTIVE_TIME_DIFF, USER_ID2);
        // user3 and user4 are active (not stale timestamp)
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID3);
        await zadd(REDIS_KEY_STATUS, Date.now() - ACTIVE_TIME_DIFF, USER_ID4);

        await timeout.handler();

        // confirm that the user's TIMEOUT activity is saved to DynamoDB
        expect(mockPutItem).toHaveBeenCalledTimes(2);
        expect(mockPutItem).toHaveBeenNthCalledWith(1, {
            TableName: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: USER_ID1 },
                timestamp: { S: expect.anything() },
                type: { S: "TIMEOUT" }
            }
        });
        expect(mockPutItem).toHaveBeenNthCalledWith(2, {
            TableName: DYNAMO_DB_CONFIG.userActivityHistoryTable,
            Item: {
                user_id: { S: USER_ID2 },
                timestamp: { S: expect.anything() },
                type: { S: "TIMEOUT" }
            }
        });
    });
});
