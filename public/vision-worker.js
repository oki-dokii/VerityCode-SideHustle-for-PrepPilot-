/* Classic worker: MediaPipe's WASM loader uses importScripts. No frames leave this worker. */
self.exports = {};
importScripts('/vision/vision_bundle.js');
let detector, phoneDetector, phoneTime = -Infinity, phoneScore;
function eyeFeatures(points) {
  if (!points || points.length < 478) return;
  const eyes = [[33,133,159,145,468],[362,263,386,374,473]].map(([a,b,top,bottom,iris]) => {
    let left=points[a],right=points[b]; if(left.x>right.x)[left,right]=[right,left];
    const dx=right.x-left.x,dy=right.y-left.y,w=Math.hypot(dx,dy);
    if(w<.02 || Math.hypot(points[top].x-points[bottom].x,points[top].y-points[bottom].y)/w<.12)return;
    const ix=points[iris].x-left.x,iy=points[iris].y-left.y;
    return {x:(ix*dx+iy*dy)/(w*w),y:(iy*dx-ix*dy)/(w*w)};
  });
  if(eyes.some(e=>!e))return;
  return {x:(eyes[0].x+eyes[1].x)/2,y:(eyes[0].y+eyes[1].y)/2};
}
const canvas = new OffscreenCanvas(640, 480);
const context = canvas.getContext('2d', { willReadFrequently: true });
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { FaceLandmarker, FilesetResolver } = self.exports;
      detector = await FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('/vision'), {
        baseOptions: { modelAssetPath: '/vision/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2, outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
      });
      try {
        phoneDetector = await self.exports.ObjectDetector.createFromOptions(await FilesetResolver.forVisionTasks('/vision'), {
          baseOptions: {modelAssetPath:'/vision/efficientdet_lite0.tflite',delegate:'CPU'},
          runningMode:'VIDEO',scoreThreshold:.35,categoryAllowlist:['cell phone'],maxResults:3,
        });
      } catch (_) { phoneDetector = null; }
      self.postMessage({ type: 'ready', phoneReady:!!phoneDetector });
    } else if (data.type === 'frame') {
      const start = performance.now();
      canvas.width = Math.min(640, data.bitmap.width);
      canvas.height = Math.round(canvas.width * data.bitmap.height / data.bitmap.width);
      context.drawImage(data.bitmap, 0, 0, canvas.width, canvas.height);
      data.bitmap.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let luminance = 0;
      for (let i = 0; i < pixels.length; i += 64) luminance += (pixels[i] + pixels[i+1] + pixels[i+2])/3;
      luminance /= pixels.length / 64;
      const usable = luminance >= 25 && luminance <= 240;
      const result = usable ? detector.detectForVideo(canvas, data.time) : null;
      if (usable && phoneDetector && data.time-phoneTime>=1000) {
        try {
          const objects=phoneDetector.detectForVideo(canvas,data.time);
          phoneScore=Math.max(0,...objects.detections.flatMap(d=>d.categories.filter(c=>c.categoryName==='cell phone').map(c=>c.score)));
          phoneTime=data.time;
        } catch (_) {phoneScore=undefined;phoneDetector=null;}
      }
      self.postMessage({ type: 'sample', phoneReady:!!phoneDetector, phoneTime, phoneScore:usable?phoneScore:undefined,
        eyes:result?.faceLandmarks.length===1?eyeFeatures(result.faceLandmarks[0]):undefined, time: data.time, faces: result?.faceLandmarks.length || 0, usable,
        matrix: result?.facialTransformationMatrixes[0]?.data,
        inferenceMs: performance.now()-start });
    }
  } catch (error) { self.postMessage({ type: 'error', message: String(error) }); }
};
