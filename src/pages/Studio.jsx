import React, { useState, useEffect, useRef, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

import StudioTopBar from '@/components/studio/StudioTopBar';
import StudioSidebar from '@/components/studio/StudioSidebar';
import StudioTimeline from '@/components/studio/StudioTimeline';

import DirectorModule from '@/components/studio/modules/DirectorModule';
import CastingModule from '@/components/studio/modules/CastingModule';
import LocationsModule from '@/components/studio/modules/LocationsModule';
import EditorModule from '@/components/studio/modules/EditorModule';
import AudioModule from '@/components/studio/modules/AudioModule';
import ScriptModule from '@/components/studio/modules/ScriptModule';
import AssetsModule from '@/components/studio/modules/AssetsModule';
import SettingsModule from '@/components/studio/modules/SettingsModule';

const MODULE_LABELS = {
  director: 'Director',
  casting: 'Casting',
  locations: 'Locations',
  editor: 'Editor',
  audio: 'Audio',
  script: 'Script',
  assets: 'Assets',
  settings: 'Settings',
};

export default function Studio() {
  const [activeModule, setActiveModule] = useState('director');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);

  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [characters, setCharacters] = useState([]);
  const [locations, setLocations] = useState([]);
  const [activeSceneId, setActiveSceneId] = useState(null);

  const [saveStatus, setSaveStatus] = useState('saved');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  const saveTimer = useRef(null);

  // Load initial data
  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    const [projs, chars, locs] = await Promise.all([
      base44.entities.StudioProject.list('-updated_date', 20),
      base44.entities.StudioCharacter.list('-created_date', 50),
      base44.entities.StudioLocation.list('-created_date', 50),
    ]);
    setProjects(projs);
    setCharacters(chars);
    setLocations(locs);

    if (projs.length > 0) {
      const proj = projs[0];
      setActiveProject(proj);
      const scns = await base44.entities.StudioScene.filter({ project_id: proj.id }, 'sequence_order', 100);
      setScenes(scns);
      if (scns.length > 0) setActiveSceneId(scns[0].id);
    }
  };

  const loadScenes = async (projectId) => {
    const scns = await base44.entities.StudioScene.filter({ project_id: projectId }, 'sequence_order', 100);
    setScenes(scns);
    if (scns.length > 0) setActiveSceneId(scns[0].id);
    else setActiveSceneId(null);
  };

  const handleProjectSelect = async (proj) => {
    setActiveProject(proj);
    await loadScenes(proj.id);
  };

  const handleNewProject = async () => {
    const proj = await base44.entities.StudioProject.create({ name: 'Untitled Project', settings_json: '{}' });
    setProjects(prev => [proj, ...prev]);
    setActiveProject(proj);
    setScenes([]);
    setActiveSceneId(null);
  };

  const handleProjectNameChange = async (name) => {
    if (!activeProject) return;
    setSaveStatus('saving');
    await base44.entities.StudioProject.update(activeProject.id, { name });
    setActiveProject(p => ({ ...p, name }));
    setProjects(prev => prev.map(p => p.id === activeProject.id ? { ...p, name } : p));
    setSaveStatus('saved');
  };

  // Auto-save every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      if (activeProject) {
        setSaveStatus('saving');
        await base44.entities.StudioProject.update(activeProject.id, { updated_date: new Date().toISOString() });
        setSaveStatus('saved');
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [activeProject]);

  const handleUpdateSettings = async (settings) => {
    if (!activeProject) return;
    setSaveStatus('saving');
    await base44.entities.StudioProject.update(activeProject.id, { settings_json: JSON.stringify(settings) });
    setSaveStatus('saved');
  };

  // Scene generation
  const handleGenerateScene = async (sceneData) => {
    if (!activeProject) {
      // Create a project first
      const proj = await base44.entities.StudioProject.create({ name: 'My First Project', settings_json: '{}' });
      setProjects(prev => [proj, ...prev]);
      setActiveProject(proj);
      generateScene(proj.id, sceneData);
    } else {
      generateScene(activeProject.id, sceneData);
    }
  };

  const generateScene = async (projectId, sceneData) => {
    setIsGenerating(true);
    setGenerationProgress(0);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setGenerationProgress(p => Math.min(p + 8, 85));
    }, 400);

    try {
      // Assemble prompt
      const char = characters.find(c => c.id === sceneData.character_id);
      const loc = locations.find(l => l.id === sceneData.location_id);
      const prompt = [
        char ? char.description : '',
        loc ? loc.description : '',
        sceneData.camera_angle ? `${sceneData.camera_angle} shot` : '',
        sceneData.lighting ? `${sceneData.lighting} lighting` : '',
        sceneData.motion ? sceneData.motion : '',
        sceneData.scene_action,
        'cinematic, 4K, film quality, professional cinematography',
      ].filter(Boolean).join(', ');

      const result = await base44.integrations.Core.GenerateImage({ prompt });

      clearInterval(progressInterval);
      setGenerationProgress(100);

      const newScene = await base44.entities.StudioScene.create({
        project_id: projectId,
        sequence_order: scenes.length,
        character_id: sceneData.character_id || '',
        location_id: sceneData.location_id || '',
        camera_angle: sceneData.camera_angle,
        lighting: sceneData.lighting,
        motion: sceneData.motion,
        scene_action: sceneData.scene_action,
        generated_output_url: result.url,
        output_type: 'image',
        duration_seconds: 5,
        prompt_used: prompt,
      });

      setScenes(prev => [...prev, newScene]);
      setActiveSceneId(newScene.id);
    } catch (err) {
      clearInterval(progressInterval);
      console.error('Generation error:', err);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(0);
    }
  };

  const handleAddScene = () => {
    setActiveModule('director');
  };

  const activeScene = scenes.find(s => s.id === activeSceneId);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey && e.key === 's') { e.preventDefault(); setSaveStatus('saving'); setTimeout(() => setSaveStatus('saved'), 600); }
      if (e.metaKey && e.key === 'Enter') { e.preventDefault(); if (activeModule === 'director') { /* trigger generate */ } }
      if (e.key === 'Escape') { /* close drawers */ }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeModule]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#1A1A1A', overflow: 'hidden', fontFamily: '"DM Sans", sans-serif',
    }}>
      {/* Top bar */}
      <StudioTopBar
        project={activeProject}
        onProjectNameChange={handleProjectNameChange}
        saveStatus={saveStatus}
        onExport={() => alert('Export coming soon!')}
      />

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        <StudioSidebar
          activeModule={activeModule}
          onModuleChange={setActiveModule}
          projects={projects}
          activeProjectId={activeProject?.id}
          onProjectSelect={handleProjectSelect}
          onNewProject={handleNewProject}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(p => !p)}
        />

        {/* Center canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Module label bar */}
          <div style={{ height: 36, borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 6, flexShrink: 0 }}>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Studio
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>/</span>
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {MODULE_LABELS[activeModule]}
            </span>
            {activeProject && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>/</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{activeProject.name}</span>
              </>
            )}
            <div style={{ flex: 1 }} />
            {activeModule === 'director' && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
                ⌘↵ Generate · ⌘S Save
              </div>
            )}
          </div>

          {/* Module canvas */}
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {activeModule === 'director' && (
              <DirectorModule
                characters={characters}
                locations={locations}
                activeScene={activeScene}
                onGenerateScene={handleGenerateScene}
                isGenerating={isGenerating}
                generationProgress={generationProgress}
              />
            )}
            {activeModule === 'casting' && (
              <CastingModule
                characters={characters}
                onRefresh={() => base44.entities.StudioCharacter.list('-created_date', 50).then(setCharacters)}
              />
            )}
            {activeModule === 'locations' && (
              <LocationsModule
                locations={locations}
                onRefresh={() => base44.entities.StudioLocation.list('-created_date', 50).then(setLocations)}
              />
            )}
            {activeModule === 'editor' && (
              <EditorModule scenes={scenes} onAddScene={handleAddScene} />
            )}
            {activeModule === 'audio' && <AudioModule />}
            {activeModule === 'script' && <ScriptModule />}
            {activeModule === 'assets' && (
              <AssetsModule scenes={scenes} characters={characters} locations={locations} />
            )}
            {activeModule === 'settings' && (
              <SettingsModule project={activeProject} onUpdateSettings={handleUpdateSettings} />
            )}
          </div>

          {/* Timeline — hidden for Director module (it has its own built-in strip) */}
          {activeModule !== 'director' && (
            <StudioTimeline
              scenes={scenes}
              activeSceneId={activeSceneId}
              onSceneSelect={(scene) => { setActiveSceneId(scene.id); setActiveModule('director'); }}
              onAddScene={handleAddScene}
              collapsed={timelineCollapsed}
              onToggle={() => setTimelineCollapsed(p => !p)}
            />
          )}
        </div>
      </div>

      <style>{`
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(229,57,53,0.5); }
      `}</style>
    </div>
  );
}