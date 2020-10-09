import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { poseNet } from 'ml5'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Canvas, useFrame, useThree } from 'react-three-fiber'
import { OrbitControls } from 'drei'
import { useSprings, a } from 'react-spring/three'
import {useDropzone} from 'react-dropzone'

import './App.css'

function WebcamVideo(props){
  const video = useRef(null)

  useEffect(() => {
    if (!video.current) return;

    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      video.current.srcObject = stream
    });
  }, [video])

  return <video {...props} width={window.innerWidth} height={window.innerHeight} ref={video} autoPlay muted playsInline />;
}

export function InstancedKeypoints({ geometry, material }) {

  // mesh refs
  let group = useRef()
  let mesh = useRef()

  // pose relatedrefs
  let keypointsRef = useRef([])
  let poseNetRef = useRef(false)
  let frameRef = useRef(0)
  let videoRef = useRef(false)

  let threeData = useThree()

  const poseResults = useRef(new Array(17).fill().map(_ => ([0, 0])))
  const [keypoints, setKeypoints] = useSprings(17, index => ({point: poseResults.current[index]}))

  // dummy THREE obj for instance mesh (v fast haha)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  const [initialCamDirection, origin] = useMemo(() => {
    return [threeData.camera.getWorldDirection().clone(), new THREE.Vector3(0, 0, 0)]
  }, [])

  const setKeypointsRef = useCallback(results => {
    if(results.length === 0) return

    keypointsRef.current = results.map(({ pose }) => pose.keypoints).reduce((acc, val) => {
      return acc.concat(val)
    })

    keypointsRef.current.forEach((keypoint, index) => {
      if(keypoint.score > 0.5) {
        const normalized = new THREE.Vector2(((keypoint.position.x + ((window.innerWidth - 950) / 2)) / window.innerWidth) * 2 - 1,
        -(keypoint.position.y / window.innerHeight ) * 2 + 1);

        threeData.raycaster.setFromCamera(normalized, threeData.camera)

        threeData.raycaster.ray.at(50, dummy.position)
      }else {
        // push it out of the camera clipping plane
        dummy.position.z = -1000
      }

      dummy.updateMatrix()
      mesh.current.setMatrixAt(index, dummy.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
  }, [])

  const setKeypointsSpring = useCallback(results => {
    if(results.length === 0) return

    poseResults.current = results[0].pose.keypoints.map((point, i) => point.score > 0.5 ? [point.position.x, point.position.y] : poseResults.current[i])
    setKeypoints(index => ({
      point: poseResults.current[index],
      onFrame: ({point}) => {
        const normalized = new THREE.Vector3((point[0] / window.innerWidth) * 2 - 1,
        -(point[1] / window.innerHeight ) * 2 + 1, -1);

        threeData.raycaster.set(origin, normalized.normalize())
        threeData.raycaster.ray.at(50, dummy.position)

        dummy.updateMatrix()
        mesh.current.setMatrixAt(index, dummy.matrix)
        mesh.current.instanceMatrix.needsUpdate = true
      }
    }))
  }, [])

  const onPose = useCallback(results => {
    if(results.length === 0) return

    // setKeypointsRef(results)
    setKeypointsSpring(results)
  }, [])

  // onLoad
  useEffect(() => {

    let video = document.createElement('video')
    video.setAttribute("autoPlay", true)
    video.setAttribute("width", window.innerWidth)
    video.setAttribute("height", window.innerHeight)

    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
      video.addEventListener("playing", () => {
        // video.setAttribute("width", 950)
        // console.log(video.videoHeight)

        videoRef.current = video

        // Create a new poseNet method
        const poses = poseNet(() => {
          // poses.singlePose(video)
          console.log("model loaded")
          poseNetRef.current = poses
        }, {
          flipHorizontal: true,
          detectionType: 'single',
          maxPoseDetections: 1,
          imageScaleFactor: 0.7
        });

        // Listen to new 'pose' events
        poses.on('pose', onPose);
      })

      video.srcObject = stream
    });
  }, [])

  // avoid recreating geometry & material
  const torusGeometry = useMemo(() => {
    return new THREE.TorusBufferGeometry(3, 1, 20, 20)
  }, [])

  useFrame(() => {
    if(!poseNetRef.current || !videoRef.current) return

    if(frameRef.current % 5 == 0) {
      poseNetRef.current.singlePose(videoRef.current)
    }

    frameRef.current++
  })

  return (
    <group ref={group} position={[0, 0, 0]} rotation={[0, 0, 0]}>
      <a.instancedMesh ref={mesh} args={[null, null, 17]} geometry={geometry} material={material} />
    </group>
  )
}


function App() {
  const loader = useMemo(() => new GLTFLoader(), [])
  const [droppedMesh, setDroppedMesh] = useState(null)

  const onParse = useCallback(data => {
    const mesh = data.scene.children[0]
    console.log(mesh)
    setDroppedMesh(mesh)
  }, [])

  const onError = useCallback(data => {
    console.log(data)
  }, [])

  const onDrop = useCallback(acceptedFiles => {
    acceptedFiles.forEach((file) => {
      const reader = new FileReader()

      reader.onabort = () => console.log('file reading was aborted')
      reader.onerror = () => console.log('file reading has failed')
      reader.onload = () => {
        // Do whatever you want with the file contents
        const binaryStr = reader.result
        // console.log(binaryStr)

        loader.parse(binaryStr, "/", onParse, onError)
        // console.log(mesh)
        // setDroppedMesh(mesh)
      }
      reader.readAsArrayBuffer(file)
    })
  }, [])
  const {getRootProps, getInputProps, isDragActive} = useDropzone({onDrop})

  const [geometry, material] = useMemo(() => {
    if(!droppedMesh){
      const torusGeometry = new THREE.TorusBufferGeometry(3, 1, 20, 20)
      const torusMaterial = new THREE.MeshNormalMaterial()
      return [torusGeometry, torusMaterial]
    }else {
      return [droppedMesh.geometry, droppedMesh.material]
    }
  }, [droppedMesh])

  return (
    <div className="App" {...getRootProps()}>
      <input {...getInputProps()} />
      <WebcamVideo autoPlay />
      <Canvas className="App__canvas"  style={{position: "fixed", height: "100vh", top: 0}}>
        <ambientLight />
        <pointLight position={[10, 10, 10]} />
        <InstancedKeypoints geometry={geometry} material={material} />
        <OrbitControls />
      </Canvas>
    </div>
  );
}

// notes for a spring based pose approach

// keeping all our keypoints so we can just map to the array and concat all arrays for useSpring(s)
// const poseResults = useRef(new Array(17).fill().map(_ => [0, 0, -1000]))
// const [keypoints, setKeypoints] = useSprings(17, index => poseResults.current[index])

// Update springs with new props
// poseResults.current = results[0].pose.keypoints.map((point, i) => point.score > 0.5 ? point.position : poseResults.current[i])
// setKeypoints(index => ({
//   points: poseResults.current[index],
//   onFrame: ({points}) => {
//       points.forEach(point => {
//         const normalized = new THREE.Vector2(((point[0] + ((window.innerWidth - 950) / 2)) / window.innerWidth) * 2 - 1,
//         -(point[1] / window.innerHeight ) * 2 + 1);
//
//         threeData.raycaster.setFromCamera(normalized, threeData.camera)
//
//         threeData.raycaster.ray.at(50, dummy.position)
//
//         dummy.updateMatrix()
//         mesh.current.setMatrixAt(index, dummy.matrix)
//       })
//       mesh.current.instanceMatrix.needsUpdate = true
//     }
// }))

// would ref-current-instanceMatrix={} work? idk

// for multiple poses (maybe)
// keypoints.current = results.map((pose, poseIndex) => pose.keypoints.map((point, i) => point.score > 0.5 ? point.position : keypoints.current[poseIndex * 17 + i])).reduce((acc, val) => {
//   return acc.concat(val)
// })

export default App;
