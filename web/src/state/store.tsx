import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as api from "@/lib/api";
import { assignCourseAccents } from "@/lib/accents";
import { ApiError } from "@/lib/api";
import type { ConnectionInfo, CourseDetail, CourseRow, ProgressRow } from "@/lib/types";
import { toast } from "@/components/ui/toast";

/**
 * The state every screen shares: the course list, the course currently open,
 * and the connection. Everything else is local to the screen that owns it.
 *
 * Course requests are sequenced. A response that was in flight when the reader
 * moved to another course must not paint, which is the bug the previous
 * frontend carried a `routeSeq` counter to avoid.
 */
interface Store {
  courses: CourseRow[] | null;
  coursesError: string | null;
  reloadCourses: () => Promise<void>;

  cid: string | null;
  course: CourseDetail | null;
  courseError: string | null;
  courseLoading: boolean;
  reloadCourse: () => Promise<void>;

  connection: ConnectionInfo | null;
  refreshConnection: () => Promise<void>;

  progress: ProgressRow | null;
  setProgress: (p: ProgressRow | null) => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}

/** The 428 path opens the connect dialog. Screens own that dialog, so they
 *  register the opener here rather than every fetch knowing about it. */
interface ConnectBridge {
  open: () => void;
}
const ConnectContext = createContext<ConnectBridge>({ open: () => {} });

export function useConnect() {
  return useContext(ConnectContext);
}

export function ConnectProvider({
  open,
  children,
}: {
  open: () => void;
  children: ReactNode;
}) {
  return <ConnectContext.Provider value={{ open }}>{children}</ConnectContext.Provider>;
}

/**
 * Turn any thrown error into the one message the reader sees, and open the
 * connect dialog when the backend says the key is missing. Ported from the
 * previous frontend's `handle()`, including both status codes it special-cased.
 */
export function useErrorHandler() {
  const connect = useConnect();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 428) {
        toast(err.message);
        connect.open();
        return;
      }
      if (err instanceof ApiError && err.status === 429) {
        toast(`Rate limited. ${err.message}`);
        return;
      }
      console.error(err);
      toast(err instanceof Error ? err.message : String(err));
    },
    [connect],
  );
}

export function StoreProvider({ cid, children }: { cid: string | null; children: ReactNode }) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [coursesError, setCoursesError] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [courseLoading, setCourseLoading] = useState(false);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [progress, setProgress] = useState<ProgressRow | null>(null);

  const courseSeq = useRef(0);

  const reloadCourses = useCallback(async () => {
    try {
      const rows = await api.listCourses();
      // The course accent palette is assigned from the whole set rather than
      // from each id on its own, so that no two courses share a colour. This is
      // the only place the full list arrives, which makes it the only place the
      // assignment can be made. See `assignCourseAccents`.
      assignCourseAccents(rows.map((row) => row.id));
      setCourses(rows);
      setCoursesError(null);
    } catch (err) {
      setCoursesError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reloadCourse = useCallback(async () => {
    if (!cid) return;
    const seq = ++courseSeq.current;
    setCourseLoading(true);
    try {
      const detail = await api.getCourse(cid);
      if (seq !== courseSeq.current) return;
      setCourse(detail);
      setCourseError(null);
    } catch (err) {
      if (seq !== courseSeq.current) return;
      setCourse(null);
      setCourseError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === courseSeq.current) setCourseLoading(false);
    }
  }, [cid]);

  const refreshConnection = useCallback(async () => {
    try {
      setConnection(await api.getConnection());
    } catch {
      setConnection(null);
    }
  }, []);

  useEffect(() => {
    void reloadCourses();
  }, [reloadCourses]);

  useEffect(() => {
    void refreshConnection();
  }, [refreshConnection]);

  useEffect(() => {
    if (!cid) {
      courseSeq.current += 1; // invalidate anything in flight
      setCourse(null);
      setCourseError(null);
      setCourseLoading(false);
      setProgress(null);
      return;
    }
    setCourse(null);
    setProgress(null);
    void reloadCourse();
  }, [cid, reloadCourse]);

  return (
    <StoreContext.Provider
      value={{
        courses,
        coursesError,
        reloadCourses,
        cid,
        course,
        courseError,
        courseLoading,
        reloadCourse,
        connection,
        refreshConnection,
        progress,
        setProgress,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
