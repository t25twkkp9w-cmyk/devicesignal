const backend = process.env.DEVICETRAIL_BACKEND_URL || process.env.MDR_BACKEND_URL || 'http://127.0.0.1:8000';
export default {
  async rewrites() {
    return [{source: '/api/:path*', destination: `${backend}/api/:path*`}];
  },
};
