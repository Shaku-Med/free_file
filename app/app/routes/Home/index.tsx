import { useState, useEffect, useRef, useCallback } from "react";
import DateSection from "./components/DateSection";
import SelectionToolbar from "./components/SelectionToolbar";
import FloatingActionButton from "./components/FloatingActionButton";
import MediaSection from "./components/MediaSection";

export default function PhotoDashboard() {


  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto px-6 xl:px-8 max-w-full xl:container py-8">
        
        <MediaSection/>
        
        <FloatingActionButton />
      </div>
    </div>
  );
}