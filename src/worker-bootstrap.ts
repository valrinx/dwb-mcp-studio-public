import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

if (
  !process.env.DWB_EXTERNAL_ENTRY ||
  !process.env.DWB_CONFIG_TARGET ||
  !process.env.DWB_DC_CONFIG_HOME
)
  throw new Error('Start this worker through the N3zuui broker.');
// Change config home in this process only. Never patch the external install on disk.
register('./worker-config-loader.js', import.meta.url);
await import(pathToFileURL(process.env.DWB_EXTERNAL_ENTRY).href);
