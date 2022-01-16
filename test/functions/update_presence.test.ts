const { promisify } = require('util');
import { Client } from 'pg';
import * as mockRedis from 'redis-mock';
import * as update_presence from '../../src/functions/update_presence/update_presence';
jest.mock('redis', () => mockRedis);

jest.mock('pg', () => {
    const mockPgClient = {
        connect: jest.fn(),
        query: jest.fn(),
        end: jest.fn(),
    };
    return { Client: jest.fn(() => mockPgClient) };
});

describe("AWS Lambda function - update_presence", () => {
    let pgClient;

    beforeEach(() => {
        pgClient = new Client();
    });

    it('exports a handler function', () => {
        expect(update_presence).toHaveProperty('handler');
        expect(typeof update_presence.handler).toBe('function');
    });
});
