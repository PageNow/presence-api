const { promisify } = require('util');
const { Client } = require('pg');
import * as mockRedis from 'redis-mock';
import * as close_connection from '../../src/functions/close_connection/close_connection';
import { 
    REDIS_KEY_USER_CONNECTION, REDIS_KEY_CONNECTION_USER, REDIS_KEY_PAGE,
    REDIS_KEY_LATEST_PAGE, REDIS_KEY_STATUS
} from '../../src/layer/nodejs/constants';

jest.mock('redis', () => mockRedis);

const data = {
    connectionId1: 'connectionId1',
    userId1: 'userId1',
    status1: Date.now(),
    page1: {
        url: 'https://www.pagenow.io',
        title: 'PageNow'
    },
    latestPage1: {
        url: 'https://www.noninertialframe.com',
        title: 'Noninertial Frame'
    }
};

const dbConfig = {
    user: 'ylee',
    host: 'localhost',
    database: 'test_core_db',
    password: 'password',
    port: 5432
};

describe("AWS Lambda function - close_connection", () => {
    const redisClient = mockRedis.createClient();
    const hget = promisify(redisClient.hget).bind(redisClient);
    const hset = promisify(redisClient.hset).bind(redisClient);
    const zadd = promisify(redisClient.zadd).bind(redisClient);
    const zscore = promisify(redisClient.zscore).bind(redisClient);

    let pgClient;

    beforeAll(async () => {
        process.env = {
            DB_USER: dbConfig.user,
            DB_HOST: dbConfig.host,
            DB_DATABASE: dbConfig.database,
            DB_PASSWORD: dbConfig.password
        };

        pgClient = new Client({
            host: dbConfig.host,
            user: dbConfig.user,
            database: dbConfig.database,
            password: dbConfig.password,
            port: dbConfig.port,
        });
        await pgClient.connect();

        const text = `
            CREATE TABLE IF NOT EXISTS friendship_table (
                user_id1     VARCHAR(50),
                user_id2     VARCHAR(50),
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at  TIMESTAMP,
                PRIMARY KEY (user_id1, user_id2)
            );`;
        await pgClient.query(text);
    });

    beforeEach(async () => {
        await hset(REDIS_KEY_CONNECTION_USER, data.connectionId1, data.userId1);
        await hset(REDIS_KEY_USER_CONNECTION, data.userId1, data.connectionId1);
        await hset(REDIS_KEY_PAGE, data.userId1, JSON.stringify(data.page1));
        await hset(REDIS_KEY_LATEST_PAGE, data.userId1, JSON.stringify(data.latestPage1));
        await zadd(REDIS_KEY_STATUS, data.status1, data.userId1);
    });

    afterAll(async () => {
        // drop table
        const text = 'DROP TABLE friendship_table';
        await pgClient.query(text);
        await pgClient.end();
    });

    it('exports a handler function', () => {
        expect(close_connection).toHaveProperty('handler');
        expect(typeof close_connection.handler).toBe('function');
    });

    it('should remove user data from Redis', async () => {
        // verify that Redis data is there
        expect(hget(REDIS_KEY_CONNECTION_USER, data.connectionId1)).resolves.toBe(data.userId1);
        expect(hget(REDIS_KEY_USER_CONNECTION, data.userId1)).resolves.toBe(data.connectionId1);
        expect(hget(REDIS_KEY_PAGE, data.userId1)).resolves.toBe(JSON.stringify(data.page1));
        expect(hget(REDIS_KEY_LATEST_PAGE, data.userId1)).resolves.toBe(JSON.stringify(data.latestPage1));
        expect(zscore(REDIS_KEY_STATUS, data.userId1)).resolves.toBe(data.status1.toString());

        const event = {
            requestContext: {
                connectionId: data.connectionId1
            }
        };
        await close_connection.handler(event);

        await expect(hget(REDIS_KEY_CONNECTION_USER, data.connectionId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_USER_CONNECTION, data.userId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_PAGE, data.userId1)).resolves.toBe(null);
        await expect(hget(REDIS_KEY_LATEST_PAGE, data.userId1)).resolves.toBe(null);
        await expect(zscore(REDIS_KEY_STATUS, data.userId1)).resolves.toBe(null);
    });
});
