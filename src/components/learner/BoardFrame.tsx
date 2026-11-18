"use client";
import { useEffect, useRef, useState } from "react";
import type { PreparedLesson } from "../../domain/lesson";
import { sceneAt } from "../../domain/lesson";
import { frameAt } from "../../domain/framing";
import Board from "../Board";
export default function BoardFrame({
  lesson,
  time,
  playing,
  reduced,
  highlights,
  seekVersion,
}: {
  lesson: PreparedLesson;
  time: number;
  playing: boolean;
  reduced: boolean;
  highlights: string[];
  seekVersion: number;
}) {
  const [mobile, setMobile] = useState(false),
    [all, setAll] = useState(false),
    [following, setFollowing] = useState(true),
    [y, setY] = useState(0);
  const previous = useRef(seekVersion),
    index = sceneAt(lesson, time);
  useEffect(() => {
    const m = matchMedia("(max-width: 760px)"),
      change = () => setMobile(m.matches);
    change();
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const explicitSeek = previous.current !== seekVersion;
    previous.current = seekVersion;
    if (following && !all && (playing || explicitSeek))
      setY(frameAt(lesson, time).y);
  }, [index, playing, following, all, seekVersion, lesson, time]);
  const live = lesson.plan.source === "live-generated";
  return (
    <>
      <div className="board-framing">
        <span>
          Step {index + 1} of {lesson.scenes.length}
        </span>
        <div>
          <button
            aria-pressed={all}
            onClick={() => {
              setAll(!all);
              setFollowing(false);
            }}
          >
            {all ? "Focus view" : "All working"}
          </button>
          {mobile && (
            <button
              aria-pressed={following}
              onClick={() => {
                setFollowing(true);
                setAll(false);
                setY(frameAt(lesson, time).y);
              }}
            >
              Follow step
            </button>
          )}
        </div>
      </div>
      <div
        className={`board-canvas ${all ? "all-working" : ""}`}
        onPointerDown={() => {
          if (mobile) setFollowing(false);
        }}
        onScroll={() => {
          if (mobile) setFollowing(false);
        }}
        tabIndex={0}
        aria-label="Whiteboard. On small screens scroll sideways to explore both sides."
      >
        <Board
          lesson={lesson}
          time={time}
          reduced={reduced}
          highlights={highlights}
          viewBox={
            mobile
              ? `0 ${all ? 0 : y} ${live ? 760 : 960} ${all ? 575 : 280}`
              : live
                ? "0 0 760 575"
                : "0 0 960 575"
          }
        />
      </div>
      {mobile && (
        <p className="pan-hint">
          Scroll sideways for both sides · “All working” keeps earlier steps
          accessible.
        </p>
      )}
    </>
  );
}
