import { ColumnOptions, CreateDateColumn, DefaultNamingStrategy, NamingStrategyInterface, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Maps camelCase properties to snake_case columns/tables (tenantId -> tenant_id). */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  private snake(s: string) {
    return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }
  tableName(className: string, customName?: string) {
    return customName ?? this.snake(className);
  }
  columnName(propertyName: string, customName: string | undefined, prefixes: string[]) {
    return this.snake(prefixes.concat(customName ?? propertyName).join('_'));
  }
  relationName(propertyName: string) {
    return this.snake(propertyName);
  }
  joinColumnName(relationName: string, referencedColumnName: string) {
    return this.snake(`${relationName}_${referencedColumnName}`);
  }
  joinTableName(first: string, second: string, firstProperty: string) {
    return this.snake(`${first}_${firstProperty.replace(/\./g, '_')}_${second}`);
  }
  joinTableColumnName(tableName: string, propertyName: string, columnName?: string) {
    return this.snake(`${tableName}_${columnName ?? propertyName}`);
  }
}

/** numeric columns come back from pg as strings; expose them as numbers. */
export const money: ColumnOptions = {
  type: 'numeric',
  precision: 12,
  scale: 2,
  default: 0,
  transformer: { to: (v?: number | null) => v, from: (v?: string | null) => (v == null ? v : Number(v)) },
};
export const rate: ColumnOptions = { ...money, precision: 5, scale: 2 };

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date;
}
