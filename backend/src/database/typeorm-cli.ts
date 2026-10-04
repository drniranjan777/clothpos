// DataSource for the TypeORM CLI (migration:generate / run / revert). See package.json "migration:*" scripts.
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';

export default new DataSource({ ...dataSourceOptions, synchronize: false, logging: ['error', 'warn', 'migration'] });
