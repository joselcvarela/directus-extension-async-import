import type { ImportService } from "@directus/api/dist/services";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import type { EndpointExtensionContext } from "@directus/extensions";
import { defineEndpoint } from "@directus/extensions-sdk";
import type { Request } from "express";
import type { Knex } from "knex";
import multer from "multer";
import fs from "node:fs";
import fsp from "node:fs/promises";

const jobs: Job[] = [];

export default defineEndpoint({
  id: "async-import",
  handler: async (router, context) => {
    router.get("/", (req, res) => {
      if (!req.accountability?.user) throw new ForbiddenError();

      const can_view = jobs.filter((job) => {
        if (req.accountability?.admin) return true;
        return job.user_id === req.accountability?.user;
      });

      res.send(can_view);
    });

    router.post("/:collection/abort", async (req, res) => {
      if (!req.params.collection)
        throw new InvalidPayloadError({
          reason: "Collection parameter is missing!",
        });

      const job = jobs.find(
        (job) => job.collection === req.params.collection && !job.ended_at
      );

      if (!job)
        throw new InvalidPayloadError({
          reason: "There's currently no job running for this collection",
        });

      await job.abort();

      res.send({ job });
    });

    router.post(
      "/:collection",
      <any>multer({ dest: "tmp/" }).single("file"),
      (req, res) => {
        const job = new Job(context);

        job.start(<any>req);

        res.status(202).send({ accepted: true });
      }
    );
  },
});

class Job {
  collection?: string;
  file?: Express.Multer.File;
  error?: any;
  started_at?: Date;
  ended_at?: Date;
  user_id?: string;
  transaction?: Knex.Transaction;
  aborted_at?: Date;

  constructor(private context: EndpointExtensionContext) {}

  async abort() {
    if (this?.transaction) {
      this.aborted_at = new Date();
      await this.transaction.rollback("Job aborted!");
    }
  }

  async start(req: Request) {
    this.collection = req.params.collection;
    this.file = req.file;

    if (!this.collection)
      throw new InvalidPayloadError({
        reason: "Collection parameter is missing!",
      });

    if (!this.file)
      throw new InvalidPayloadError({
        reason: "No file uploaded!",
      });

    if (!req.accountability?.user) throw new ForbiddenError();

    if (!jobs.find((job) => job.collection === this.collection)?.ended_at)
      throw new ForbiddenError({
        reason: "Only one import is allowed per collection",
      });

    this.user_id = req.accountability.user;

    this.transaction = await this.context.database.transaction();

    const is = new (<typeof ImportService>this.context.services.ImportService)({
      knex: this.transaction,
      schema: req.schema,
      accountability: req.accountability,
    });

    this.started_at = new Date();

    jobs.push(this);

    try {
      await is.import(
        this.collection,
        this.file.mimetype,
        fs.createReadStream(this.file.path)
      );

      await this.transaction.commit();
    } catch (error) {
      this.error = error;
      await this.abort();
    } finally {
      this.ended_at = new Date();

      await fsp.unlink(this.file.path);
    }
  }

  toJSON() {
    return {
      filename: this.file?.filename ?? null,
      started_at: this.started_at ?? null,
      ended_at: this.ended_at ?? null,
      error: this.error ?? null,
      collection: this.collection ?? null,
      mimetype: this.file?.mimetype ?? null,
      size: this.file?.size ?? null,
    };
  }
}
