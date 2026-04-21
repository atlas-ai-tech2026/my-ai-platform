// Image Models
export const imageModels = [
  { id: 1, name: 'Nano Banana Pro', description: 'Best 4K image generation model' },
  { id: 2, name: 'Seedream 4.5', description: 'Next-gen 4K photorealistic images' },
  { id: 3, name: 'Seedream 5.0 Lite', description: 'Unlimited intelligent visual generation' },
  { id: 4, name: 'GPT Image', description: 'OpenAI powered image generation' },
  { id: 5, name: 'Flux Kontext', description: 'Context-aware image generation' },
  { id: 6, name: 'Soul 2.0', description: 'Fashion & culture-forward portrait model' },
];

// Video Models
export const videoModels = [
  { id: 1, name: 'Kling 2.6', description: 'Cinematic video with audio support' },
  { id: 7, name: 'Seedance 2.0', description: 'Next-gen dance & motion video generation', comingSoon: true },
  { id: 2, name: 'Kling Motion Control', description: 'Precise character movement control' },
  { id: 3, name: 'Nano Banana Pro Video', description: 'Professional AI video creation' },
  { id: 4, name: 'Sora 2', description: 'Long-form coherent storytelling video' },
  { id: 5, name: 'Veo 3.1', description: 'Photorealistic rendering with camera physics' },
  { id: 6, name: 'Wan 2.6', description: 'Stylized animation and illustrated video' },
];

// Image Templates
export const imageTemplates = [
  { 
    id: 1, 
    title: 'Cinematic Portrait', 
    category: 'Portrait', 
    model: 'Nano Banana Pro',
    prompt: 'A high-fashion editorial portrait of a woman in a dramatic dark studio, red silk dress, moody directional lighting, shallow depth of field, 4K photorealistic, film grain' 
  },
  { 
    id: 2, 
    title: 'Urban Night Scene', 
    category: 'Cinematic', 
    model: 'Seedream 4.5',
    prompt: 'A cinematic wide-angle shot of a neon-lit Tokyo street at 2AM, rain reflections on asphalt, lone figure walking, volumetric fog, blade runner aesthetic, ultra-detailed 4K' 
  },
  { 
    id: 3, 
    title: 'Product Hero Shot', 
    category: 'Product Ad', 
    model: 'Nano Banana Pro',
    prompt: 'A luxury perfume bottle on black marble surface, dramatic side lighting, water droplets, dark moody studio, commercial photography quality, 4K, ultra-sharp' 
  },
  { 
    id: 4, 
    title: 'Fashion Editorial', 
    category: 'Fashion', 
    model: 'Soul 2.0',
    prompt: 'A fashion editorial shoot, model in avant-garde couture, asymmetric architecture background, golden hour light, high-contrast shadows, Vogue magazine quality, 4K' 
  },
  { 
    id: 5, 
    title: 'Abstract 3D Art', 
    category: 'Art', 
    model: 'Seedream 5.0 Lite',
    prompt: 'Abstract 3D render of floating geometric shapes, deep red and black palette, metallic surfaces, caustic lighting, photorealistic render, 8K resolution' 
  },
  { 
    id: 6, 
    title: 'Futuristic Architecture', 
    category: 'Architecture', 
    model: 'Seedream 4.5',
    prompt: 'Futuristic skyscraper interior atrium, massive glass ceiling, red neon light strips, people as silhouettes below, ultra-wide angle, architectural photography, 4K' 
  },
  { 
    id: 7, 
    title: 'Action Hero', 
    category: 'Cinematic', 
    model: 'Nano Banana Pro',
    prompt: 'Cinematic action scene, male figure in tactical gear walking away from explosion, slow motion debris, golden fire glow, dramatic wide shot, film quality, 4K' 
  },
  { 
    id: 8, 
    title: 'Beauty Close-Up', 
    category: 'Portrait', 
    model: 'Soul 2.0',
    prompt: 'Ultra close-up beauty shot, face with flawless skin, bold red lip, dramatic eye shadow, dark background, studio beauty lighting, Vogue quality, 4K' 
  }
];

// Video Templates
export const videoTemplates = [
  { 
    id: 1, 
    title: 'Action Sequence', 
    category: 'Action', 
    model: 'Kling 2.6',
    duration: '8s', 
    motion: 'High',
    prompt: 'Cinematic action sequence, hero in black coat runs toward camera in slow motion, debris and fire around them, crash zoom, dramatic score feel, photorealistic 4K' 
  },
  { 
    id: 2, 
    title: 'Product Reveal', 
    category: 'Product Ad', 
    model: 'Kling Motion Control',
    duration: '5s', 
    motion: 'Smooth',
    prompt: 'Luxury product reveal, smartphone rises from black surface, orbit camera rotation 360 degrees, light reflections, dramatic build-up, commercial quality 4K' 
  },
  { 
    id: 3, 
    title: 'Nature Timelapse', 
    category: 'Nature', 
    model: 'Veo 3.1',
    duration: '10s', 
    motion: 'Slow',
    prompt: '4K timelapse of storm clouds rolling over mountain range at sunset, volumetric god rays, dramatic color grading, cinematic wide shot, photorealistic' 
  },
  { 
    id: 4, 
    title: 'Character Walk', 
    category: 'Character', 
    model: 'Kling 2.6',
    duration: '6s', 
    motion: 'Medium',
    prompt: 'Stylish woman walks confidently toward camera in slow motion, dark city street at night, neon reflections on wet ground, dolly push, cinematic 4K' 
  },
  { 
    id: 5, 
    title: 'Film Noir Scene', 
    category: 'Cinematic', 
    model: 'Sora 2',
    duration: '12s', 
    motion: 'Slow',
    prompt: 'Film noir scene, man in trenchcoat stands under streetlight in rain, shadows and light beams, black and white with red accent, static locked-off shot, 4K' 
  }
];

// Transitions
export const transitions = [
  { id: 1, name: 'Raven Transition', category: 'Cinematic', description: 'Dark feather wipe effect', animation: 'wipe' },
  { id: 2, name: 'Light Leak', category: 'Cinematic', description: 'Film light leak overlay', animation: 'dissolve' },
  { id: 3, name: 'Film Burn', category: 'Cinematic', description: 'Vintage film burn effect', animation: 'dissolve' },
  { id: 4, name: 'Lens Flare Cut', category: 'Cinematic', description: 'Anamorphic lens flare', animation: 'dissolve' },
  { id: 5, name: 'Cinematic Wipe', category: 'Cinematic', description: 'Classic horizontal wipe', animation: 'wipe' },
  { id: 6, name: 'Flame Transition', category: 'Elemental', description: 'Fire engulfs the scene', animation: 'dissolve' },
  { id: 7, name: 'Water Bending', category: 'Elemental', description: 'Liquid ripple effect', animation: 'dissolve' },
  { id: 8, name: 'Air Bending', category: 'Elemental', description: 'Wind blur transition', animation: 'wipe' },
  { id: 9, name: 'Smoke Dissolve', category: 'Elemental', description: 'Smoke particle dissolve', animation: 'dissolve' },
  { id: 10, name: 'Lightning Cut', category: 'Elemental', description: 'Electric flash transition', animation: 'glitch' },
  { id: 11, name: 'Crash Zoom In', category: 'Motion', description: 'Dramatic zoom in effect', animation: 'zoom' },
  { id: 12, name: 'Crash Zoom Out', category: 'Motion', description: 'Pull back zoom effect', animation: 'zoom' },
  { id: 13, name: 'Whip Pan Left', category: 'Motion', description: 'Fast pan left blur', animation: 'wipe' },
  { id: 14, name: 'Whip Pan Right', category: 'Motion', description: 'Fast pan right blur', animation: 'wipe' },
  { id: 15, name: 'Spin Transition', category: 'Motion', description: 'Rotating spin effect', animation: 'spin' },
  { id: 16, name: 'Glitch Cut', category: 'Glitch', description: 'Digital glitch distortion', animation: 'glitch' },
  { id: 17, name: 'RGB Split', category: 'Glitch', description: 'Chromatic aberration', animation: 'glitch' },
  { id: 18, name: 'Pixel Dissolve', category: 'Glitch', description: 'Pixelated dissolve', animation: 'dissolve' },
  { id: 19, name: 'Data Corrupt', category: 'Glitch', description: 'Data corruption effect', animation: 'glitch' },
  { id: 20, name: 'VHS Rewind', category: 'Glitch', description: 'Retro VHS tracking', animation: 'glitch' },
  { id: 21, name: 'Cross Dissolve', category: 'Smooth', description: 'Classic crossfade', animation: 'dissolve' },
  { id: 22, name: 'Fade to Black', category: 'Smooth', description: 'Fade out to black', animation: 'dissolve' },
  { id: 23, name: 'Fade to White', category: 'Smooth', description: 'Fade out to white', animation: 'dissolve' },
  { id: 24, name: 'Dip to Color', category: 'Smooth', description: 'Dip through color', animation: 'dissolve' },
  { id: 25, name: 'Morph Cut', category: 'Smooth', description: 'Seamless morph transition', animation: 'dissolve' },
  { id: 26, name: 'Cube Spin', category: '3D', description: '3D cube rotation', animation: 'spin' },
  { id: 27, name: 'Page Flip', category: '3D', description: 'Page turn effect', animation: 'wipe' },
  { id: 28, name: 'Portal Warp', category: '3D', description: 'Dimensional portal', animation: 'zoom' },
  { id: 29, name: 'Vortex Spin', category: '3D', description: 'Spiral vortex effect', animation: 'spin' },
  { id: 30, name: 'Depth Push', category: '3D', description: 'Push into scene', animation: 'zoom' },
];

// Apps
export const apps = [
  { id: 1, name: 'Nano Banana Pro', description: 'Best 4K image generation model', category: 'Image', icon: 'Image' },
  { id: 2, name: 'Seedream 4.5', description: 'Next-gen 4K photorealistic images', category: 'Image', icon: 'Sparkles' },
  { id: 3, name: 'Seedream 5.0 Lite', description: 'Unlimited intelligent visual generation', category: 'Image', icon: 'Zap' },
  { id: 4, name: 'Soul 2.0', description: 'Fashion & culture-forward portrait model', category: 'Image', icon: 'User' },
  { id: 5, name: 'Skin Enhancer', description: 'Natural realistic skin texture', category: 'Image', icon: 'Smile' },
  { id: 6, name: 'Face Swap', description: 'Instant AI face replacement', category: 'Image', icon: 'RefreshCw' },
  { id: 7, name: 'Angles', description: 'Generate any 3D angle view', category: 'Image', icon: 'Box' },
  { id: 8, name: 'Inpaint', description: 'Edit any region of an image', category: 'Image', icon: 'Paintbrush' },
  { id: 9, name: 'Relight', description: 'Change lighting in any image', category: 'Image', icon: 'Sun' },
  { id: 10, name: '4K Upscaler', description: 'Upscale any image to 4K resolution', category: 'Enhancement', icon: 'Maximize' },
  { id: 11, name: 'Kling 2.6', description: 'Cinematic video with audio support', category: 'Video', icon: 'Video' },
  { id: 37, name: 'Seedance 2.0', description: 'Next-gen dance & motion video generation', category: 'Video', icon: 'Sparkles', comingSoon: true },
  { id: 12, name: 'Kling Motion Control', description: 'Precise character movement control', category: 'Video', icon: 'Move' },
  { id: 13, name: 'Nano Banana Pro Video', description: 'Professional AI video creation', category: 'Video', icon: 'Film' },
  { id: 14, name: 'Sora 2', description: 'Long-form coherent storytelling video', category: 'Video', icon: 'Clapperboard' },
  { id: 15, name: 'Veo 3.1', description: 'Photorealistic rendering with camera physics', category: 'Video', icon: 'Camera' },
  { id: 16, name: 'Wan 2.6', description: 'Stylized animation and illustrated video', category: 'Video', icon: 'Palette' },
  { id: 17, name: 'Recast', description: 'Character swap for any video', category: 'Video', icon: 'Users' },
  { id: 18, name: 'Face Swap Video', description: 'Replace faces in video clips', category: 'Video', icon: 'UserCheck' },
  { id: 19, name: 'Outfit Swap', description: 'Change clothing in video', category: 'Video', icon: 'Shirt' },
  { id: 20, name: 'Video Upscaler', description: 'Upscale video to 4K', category: 'Enhancement', icon: 'Maximize2' },
  { id: 21, name: 'Click to Ad', description: 'Paste a product link → get a video ad', category: 'Marketing', icon: 'MousePointer' },
  { id: 22, name: 'AI Influencer Studio', description: 'Build and deploy AI influencer personas', category: 'Marketing', icon: 'Star' },
  { id: 23, name: 'Product Insert', description: 'Place products into any scene', category: 'Marketing', icon: 'Package' },
  { id: 24, name: 'UGC Generator', description: 'Create authentic user-generated style content', category: 'Marketing', icon: 'MessageSquare' },
  { id: 25, name: 'Brand Kit', description: 'Apply consistent brand style to all generations', category: 'Marketing', icon: 'Bookmark' },
  { id: 26, name: 'Voice Clone', description: 'Replicate any voice from a sample', category: 'Audio', icon: 'Mic' },
  { id: 27, name: 'Lipsync Studio', description: 'Sync AI speech to character lips', category: 'Audio', icon: 'MessageCircle' },
  { id: 28, name: 'Multilingual Voice', description: 'Generate voice in any language', category: 'Audio', icon: 'Globe' },
  { id: 29, name: 'ASMR Generator', description: 'Ambient and sensory audio creation', category: 'Audio', icon: 'Headphones' },
  { id: 30, name: 'Music Sync', description: 'Match video cuts to music beats', category: 'Audio', icon: 'Music' },
  { id: 31, name: 'Raven Transition', description: 'Dark cinematic feather wipe', category: 'Effects', icon: 'Feather' },
  { id: 32, name: 'Flame Transition', description: 'Fire engulfs the scene', category: 'Effects', icon: 'Flame' },
  { id: 33, name: 'Water Bending', description: 'Liquid ripple transition', category: 'Effects', icon: 'Droplets' },
  { id: 34, name: 'Air Bending', description: 'Wind blur transition', category: 'Effects', icon: 'Wind' },
  { id: 35, name: 'Glitch Cut', description: 'Digital distortion effect', category: 'Effects', icon: 'Zap' },
  { id: 36, name: '3D Render', description: 'Convert footage to 3D style', category: 'Effects', icon: 'Boxes' },
];

// Audio Templates
export const audioTemplates = [
  { id: 1, title: 'Action Trailer Voiceover', description: 'Deep dramatic narrator voice', useCase: 'Trailers' },
  { id: 2, title: 'Product Ad Read', description: 'Energetic, commercial tone', useCase: 'Ads' },
  { id: 3, title: 'ASMR Narration', description: 'Soft, whispery, close-mic feel', useCase: 'ASMR' },
  { id: 4, title: 'Documentary Style', description: 'Authoritative, steady pace', useCase: 'Documentary' },
  { id: 5, title: 'Social Media Hook', description: 'Fast, punchy, engaging opener', useCase: 'Social' },
  { id: 6, title: 'Film Scene Dialogue', description: 'Emotional, character-driven', useCase: 'Film' },
];

// Sound Effects
export const soundEffects = [
  { id: 1, name: 'Thunder Strike', duration: '3.2s', category: 'Nature' },
  { id: 2, name: 'Rain on Glass', duration: '10s', category: 'Nature' },
  { id: 3, name: 'Crowd Cheer', duration: '5s', category: 'Urban' },
  { id: 4, name: 'Explosion', duration: '2.1s', category: 'Action' },
  { id: 5, name: 'Cinematic Impact', duration: '1.8s', category: 'Cinematic' },
  { id: 6, name: 'Wind Howl', duration: '8s', category: 'Nature' },
  { id: 7, name: 'Fire Crackle', duration: '6s', category: 'Nature' },
  { id: 8, name: 'Sci-Fi Whoosh', duration: '1.2s', category: 'Sci-Fi' },
  { id: 9, name: 'Heartbeat', duration: '4s', category: 'Ambient' },
  { id: 10, name: 'Clock Ticking', duration: '5s', category: 'Ambient' },
  { id: 11, name: 'Glass Shatter', duration: '1.5s', category: 'Action' },
  { id: 12, name: 'City Traffic', duration: '15s', category: 'Urban' },
];

// Community Feed Data
export const communityFeed = [
  {
    id: 30, type: 'image', creator: 'voxel', views: '0', likes: '0', model: 'Nano Banana Pro',
    imageUrl: '/media/discover-dragon-castle.png',
    prompt: 'Cinematic wide shot of a weary medieval warrior standing in a Targaryen castle hall with dragon sigil tapestries, stone archways and gothic stained-glass windows, warm torchlight and god-rays, anamorphic flares, shot on ARRI Alexa 65 with Hawk65 Anamorphic 14mm at T1.8, ultra-detailed 4K'
  },
  { id: 20, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/af01f98cd_ChatGPTImageMar25202605_10_35PM.png', prompt: 'A massive dark dragon with glowing blue eyes and wide-spread bat-like wings hovering menacingly above a rain-soaked Cairo city boulevard, low-angle shot looking up from street level, Egyptian pyramids faintly visible in the misty background, flanked by brutalist concrete apartment buildings typical of Cairo urban architecture, heavy overcast storm atmosphere, wet asphalt reflecting city lights, scattered cars on the road, cinematic mist and fog, photorealistic 8K render, dramatic lighting, dark teal and grey color grading, hyperrealistic creature design with textured scales and horned crown, depth of field, anamorphic lens, post-apocalyptic mood, Giza pyramids silhouette through storm clouds' },
  { id: 21, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/658e39d49_hf_20260218_131102_9458d2bf-3901-424f-a3ba-7e274946b769.jpg', prompt: 'Mysterious man in all-white ensemble standing beside a covered supercar draped in translucent silk cloth, single dramatic overhead spotlight cutting through heavy atmospheric haze in a pitch-black studio, ground-level volumetric fog, wet polished concrete floor with mirror reflections, cinematic product reveal composition, editorial automotive photography, anamorphic bokeh, 4K IMAX quality' },
  { id: 22, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/db3d2e206_hf_20260222_125331_48433449-ae3d-41ba-acd2-e96cdfcc60a9.jpg', prompt: 'High-performance luxury coupe shrouded in semi-transparent white cover fabric, dramatic rear three-quarter reveal angle, dual spotlight beams cutting through dense theatrical smoke in an ink-black studio, sharp silhouette lines of aerodynamic bodywork visible beneath the veil, cinematic automotive teaser photography, deep shadows with blue-tinted ambient light, 8K ultra-sharp commercial quality' },
  { id: 23, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/1a96d2fed_hf_20260222_124200_44de52ac-0250-45a2-9a84-cc87bdf8524d.jpg', prompt: 'Iconic Mercedes-AMG GT covered in pristine white silk draping, front three-quarter reveal shot with a single god-ray spotlight piercing heavy smoke from directly above, the star emblem barely visible through translucent fabric, wet black floor reflecting soft light, ultra-dramatic luxury automotive teaser composition, Hasselblad medium format aesthetic, cinematic black-to-white tonal range, 8K photorealistic render' },
  { 
    id: 15, type: 'video', creator: 'you', views: '0', likes: '0', model: 'Seedance 2.0',
    videoUrl: 'https://videos.pexels.com/video-files/3015539/3015539-hd_1920_1080_25fps.mp4',
    prompt: 'Coming soon — your video will be added here once uploaded to a direct host'
  },
  { id: 9, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/d7e345e5c_0_01.jpg', prompt: 'A NASA astronaut in a full pressure suit floating in deep space, capturing a cinematic selfie with a sleek smartphone, dramatic pink and violet nebula in the background, volumetric light bloom, ultra-realistic textures, IMAX-grade render, 8K photorealistic' },
  { id: 10, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/dfe592984_1c9f0e5b-96cc-416e-b5a9-a94efbeede19.png', prompt: 'Extreme close-up portrait of a dark fantasy villain, long silver-white hair, piercing serpentine yellow eyes with slit pupils, intricate purple war-paint veining across pale skin, haunting sinister smile, cinematic depth of field, Unreal Engine 5 hyperrealism, 8K render' },
  { id: 11, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/bba45636f_6e354a1a-fa83-4c61-a033-e9755dd40b6a.png', prompt: 'Cinematic action movie still — a battle-hardened Santa Claus in a worn red suit and tactical sunglasses sprinting away from a collapsing burning building, cradling a frightened child, explosive fire debris flying, dynamic low-angle hero shot, anamorphic lens flare, photorealistic 4K film grain' },
  { id: 12, type: 'image', creator: 'you', views: '0', likes: '0', model: 'Nano Banana Pro', imageUrl: 'https://media.base44.com/images/public/69a83da7490a426a3f30f581/425c55211_54eeba81-1a47-406c-9f86-f4205743fcf3.png', prompt: 'Gritty cinematic scene — a menacing Santa Claus in dark sunglasses points a candy cane like a weapon at a terrified convenience store clerk, harsh fluorescent overhead lighting casting deep shadows, hyper-realistic film look, 35mm anamorphic, shallow depth of field, 4K' },
  { id: 2, type: 'video', creator: 'filmstudio', views: '8.2K', likes: '1.5K', model: 'Kling 2.6', videoUrl: 'https://videos.pexels.com/video-files/3015539/3015539-hd_1920_1080_25fps.mp4', prompt: 'Cinematic action sequence, hero in black coat runs toward camera in slow motion, debris and fire around them, crash zoom, dramatic score feel, photorealistic 4K' },
  { id: 3, type: 'image', creator: 'artmaster', views: '5.7K', likes: '890', model: 'Seedream 4.5', imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80', prompt: 'Abstract 3D render of floating geometric shapes, deep red and black palette, metallic surfaces, caustic lighting, photorealistic render, 8K resolution' },
  { id: 4, type: 'video', creator: 'motionlab', views: '15.3K', likes: '3.2K', model: 'Sora 2', videoUrl: 'https://videos.pexels.com/video-files/855282/855282-hd_1920_1080_25fps.mp4', prompt: 'Film noir scene, man in trenchcoat stands under streetlight in rain, shadows and light beams, black and white with red accent, static locked-off shot, 4K' },
  { id: 5, type: 'image', creator: 'designpro', views: '9.1K', likes: '1.8K', model: 'Soul 2.0', imageUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=80', prompt: 'Ultra close-up beauty shot, face with flawless skin, bold red lip, dramatic eye shadow, dark background, studio beauty lighting, Vogue quality, 4K' },
  { id: 6, type: 'image', creator: 'pixelartist', views: '7.5K', likes: '1.2K', model: 'Nano Banana Pro', imageUrl: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80', prompt: 'A high-fashion editorial portrait of a woman in a dramatic dark studio, red silk dress, moody directional lighting, shallow depth of field, 4K photorealistic, film grain' },
  { id: 7, type: 'video', creator: 'cinematic_', views: '22.1K', likes: '4.5K', model: 'Veo 3.1', videoUrl: 'https://videos.pexels.com/video-files/1851190/1851190-hd_1920_1080_25fps.mp4', prompt: 'Futuristic skyscraper interior atrium, massive glass ceiling, red neon light strips, people as silhouettes below, ultra-wide angle, architectural photography, 4K' },
  { id: 8, type: 'image', creator: 'creative_mind', views: '3.4K', likes: '567', model: 'Seedream 5.0 Lite', imageUrl: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80', prompt: 'A cinematic wide-angle shot of a neon-lit Tokyo street at 2AM, rain reflections on asphalt, lone figure walking, volumetric fog, blade runner aesthetic, ultra-detailed 4K' },
];

// Feature Cards
export const featureCards = [
  { id: 1, title: 'Nano Banana Pro', description: 'Our flagship 4K image model with unparalleled detail', tag: 'NEW MODEL' },
  { id: 2, title: 'Kling 3.0', description: 'Cinema-grade video generation with audio', tag: 'UNLIMITED' },
  { id: 6, title: 'Seedance 2.0', description: 'Next-gen motion & cinematic video generation', tag: 'NEW' },
  { id: 5, title: 'Voxel Studio', description: 'Build full films with AI — storyboard, animate, and edit scene by scene', tag: 'NEW' },
  { id: 3, title: 'Seedream 4.5', description: 'Photorealistic 4K images in seconds', tag: 'POPULAR' },
  { id: 4, title: 'Face Swap', description: 'Instant face replacement with perfect blending', tag: 'TRENDING' },
];

// Tool Shortcuts
export const toolShortcuts = [
  { id: 1, name: 'Create Image', path: 'Image', icon: 'Image' },
  { id: 2, name: 'Create Video', path: 'Video', icon: 'Video' },
  { id: 3, name: 'Edit Video', path: 'Edit', icon: 'Scissors' },
  { id: 4, name: 'Audio Studio', path: 'Audio', icon: 'Music' },
  { id: 5, name: 'Face Swap', path: 'Apps', icon: 'RefreshCw' },
  { id: 6, name: 'Upscale', path: 'Apps', icon: 'Maximize' },
  { id: 7, name: 'Nano Banana Pro', path: 'Image', icon: 'Sparkles' },
  { id: 8, name: 'Lipsync Studio', path: 'Audio', icon: 'MessageCircle' },
];