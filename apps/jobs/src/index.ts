import { app } from '@azure/functions';
import './functions/heartbeat.ts';

app.setup({ enableHttpStream: false });
