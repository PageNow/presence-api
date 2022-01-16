export const FRIENDSHIP_TABLE_CREATE_SQL = `
    CREATE TABLE IF NOT EXISTS friendship_table (
        user_id1     VARCHAR(50),
        user_id2     VARCHAR(50),
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at  TIMESTAMP,
        PRIMARY KEY (user_id1, user_id2)
    );
`;
