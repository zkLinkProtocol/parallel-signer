import { open } from "sqlite";
import sqlite3 from "sqlite3";
let db;
export async function dbConnect() {
  if (db) {
    return db;
  }
  db = await open({
    filename: "/tmp/database.db",
    driver: sqlite3.Database,
  });

  return db;
}

export async function initialDatabaseTables() {
  const db = await dbConnect();

  db.exec(`
    CREATE TABLE IF NOT EXISTS requests
      (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        function_data TEXT NOT NULL,
        tx_id VARCHAR(66) NOT NULL,
        chain_id INTEGER NOT NULL,
        log_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS packed_transactions
      (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nonce INTEGER NOT NULL,
        tx_id VARCHAR(66) NOT NULL,
        chain_id INTEGER NOT NULL,
        max_fee_per_gas VARCHAR(20) DEFAULT '',
        max_priority_fee_per_gas VARCHAR(20) DEFAULT '',
        gas_price VARCHAR(20) DEFAULT '',
        request_ids TEXT NOT NULL,
        confirmation INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
  `);
}
