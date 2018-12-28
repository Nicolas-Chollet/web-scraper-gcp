const HCCrawler = require(`headless-chrome-crawler`);
const BaseExporter = require(`headless-chrome-crawler/exporter/base`);
const RedisCache = require(`headless-chrome-crawler/cache/redis`);

const {BigQuery} = require(`@google-cloud/bigquery`);

const config = require(`./config`);
const bigQuerySchema = require(`./bigquery-schema`);

const bigquery = new BigQuery({
  projectId: config.projectId
});

const cache = new RedisCache({ host: '127.0.0.1', port: 6379 });

const FILE = './test.json';

let count = 0;
let start = null;

// Create a new exporter by extending BaseExporter interface
class BigQueryExporter extends BaseExporter {
  constructor(settings) {
    super(settings);
  }

  async writeLine(result) {
    if (count > 0 && count % 1000 === 0) {
      const now = new Date().getTime();
      console.log(`${count} files crawled in ${now-start} milliseconds.`)
    }
    if (process.env.NODE_ENV === 'dev') {
      console.log(`Crawled ${result.response.url}`);
    }
    count += 1;

    const item = {
      requested_url: result.options.url,
      final_url: result.response.url,
      http_status: result.response.status,
      content_type: result.response.headers['content-type'],
      external: result.response.url.indexOf('https://www.simoahava.com/') === -1,
      previous_url: result.previousUrl,
      document_title: result.result.title,
      meta_description: result.result.metaDescription
    };
    /*await bigquery
      .dataset(config.bigQuery.datasetId)
      .table(config.bigQuery.tableId)
      .insert([item]);*/

    this._stream.write(`${JSON.stringify(item)}\n`);
  }

  writeHeader() {}

  writeFooter() {}
}

const exporter = new BigQueryExporter({
  file: FILE,
  encoding: {flags: 'a'}
});

async function createBigQueryDataset() {
  try {
    const [dataset] = await bigquery.createDataset(config.bigQuery.datasetId);
    return dataset;
  } catch(e) {
    if (e.message.indexOf('Already Exists') === -1) {
      throw e;
    }
  }
}

async function createBigQueryTable() {
  const options = {
    schema: {
      fields: bigQuerySchema
    },
    timePartitioning: {
      type: 'DAY'
    }
  };
  try {
    const [table] = await bigquery
      .dataset(config.bigQuery.datasetId)
      .createTable(config.bigQuery.tableId, options);
    return table;
  } catch(e) {
    if (e.message.indexOf('Already Exists') === -1) {
      throw e;
    }
  }
}

async function launchCrawler(event, callback) {
  try {
    start = new Date().getTime();
    console.log(`Creating table ${config.bigQuery.tableId} in dataset ${config.bigQuery.datasetId}`);

    /*await createBigQueryDataset();
    await createBigQueryTable();*/

    console.log(`Starting crawl from ${config.startUrl}`);

    const crawler = await HCCrawler.launch({
      exporter,
      preRequest: (options => {
        if (options.url.indexOf(config.domain) === -1) {
          options.maxDepth = 1;
        }
        return true;
      }),
      evaluatePage: (() => ({
        title: $('title').text(),
        metaDescription: $('meta[name="description"]').attr('content')
      })),
      cache,
      persistCache: true,
      skipRequestedRedirect: true
    });

    await crawler.queue({url: config.startUrl, maxDepth: 9999999});

    // Set timeout for script
    setTimeout(() => {
      crawler.pause();
    }, 20000);

    // Shut down
    await crawler.onIdle();
    console.log(`Stopping with ${await crawler.queueSize()} items left in queue.`);
    const finish = new Date().getTime();
    console.log(`Crawl took ${finish - start} milliseconds.`);
    console.log(`Crawled ${count} files.`);
    await crawler.close();
    process.exit();
  } catch(e) {
    console.error(e);
  }
}

module.exports.launchCrawler = launchCrawler;

(async() => {
  if (['dev', 'test'].indexOf(process.env.NODE_ENV) > -1) {
    await launchCrawler('', '');
  }
})();
