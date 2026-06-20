import s3 from 'aws/s3';
import ffprobe from 'ffprobe';
import slack from 'slack';

export default async function processFile({ slackChannel, fileName }) {
    const fileUrl = await s3.getFileUrl(fileName);
    const metadata = await ffprobe(fileUrl, {
        v: 'error',
        show_format: 'flat',
        show_streams: 'flat'
    });
    await slack.postMessage(slackChannel, `File ${fileName} has been processed. Metadata: ${JSON.stringify(metadata)}`);
}