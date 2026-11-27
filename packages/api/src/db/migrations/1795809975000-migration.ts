import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1795809975000 implements MigrationInterface {
    name = 'Migration1795809975000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscribers" ADD "fbc" character varying`);
        await queryRunner.query(`ALTER TABLE "subscribers" ADD "fbp" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscribers" DROP COLUMN "fbp"`);
        await queryRunner.query(`ALTER TABLE "subscribers" DROP COLUMN "fbc"`);
    }
}
