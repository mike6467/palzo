import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import monitorRouter from "./monitor";
import transfersRouter from "./transfers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(monitorRouter);
router.use(transfersRouter);

export default router;
