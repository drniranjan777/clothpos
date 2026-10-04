import 'dotenv/config';
import { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from './base';
import { ENTITIES } from './entities';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'clothpos',
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  entities: ENTITIES,
  namingStrategy: new SnakeNamingStrategy(),
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // schema changes ship as migrations (npm run migration:run); DB_SYNC=true is only for throwaway experiments
  synchronize: process.env.DB_SYNC === 'true',
  migrationsRun: process.env.DB_MIGRATE_ON_START === 'true',
  logging: process.env.DB_LOGGING === 'true',
};
