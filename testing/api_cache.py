"""
API Response Caching Module

Provides a persistent, multi-run caching layer for API responses.
Automatically caches responses to disk and retrieves cached data
on subsequent calls, dramatically speeding up repeated queries.
"""

import json
import hashlib
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional, Callable, Tuple
import requests


class APICache:
    """
    Persistent cache for API responses.

    Stores responses in JSON files organized by endpoint type.
    Uses deterministic hashing to create cache keys.
    """

    def __init__(self, cache_dir: str = "api_cache"):
        """
        Initialize cache manager.

        Args:
            cache_dir: Directory to store cached responses
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(exist_ok=True)

        # Create subdirectories for different endpoint types
        self.stationboard_cache = self.cache_dir / "stationboard"
        self.locations_cache = self.cache_dir / "locations"

        self.stationboard_cache.mkdir(exist_ok=True)
        self.locations_cache.mkdir(exist_ok=True)

        self.stats = {
            "hits": 0,
            "misses": 0,
            "total_calls": 0,
        }

    @staticmethod
    def _make_cache_key(*args, **kwargs) -> str:
        """
        Create a deterministic cache key from arguments.

        Args:
            *args: Positional arguments
            **kwargs: Keyword arguments

        Returns:
            Hash string suitable for use as filename
        """
        # Combine all args and kwargs into a single string
        key_parts = []
        key_parts.extend(str(arg) for arg in args)
        key_parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
        key_string = "|".join(key_parts)

        # Hash the key to create a deterministic filename
        return hashlib.md5(key_string.encode()).hexdigest()

    def _get_cache_path(self, cache_type: str, cache_key: str) -> Path:
        """
        Get the full path to a cache file.

        Args:
            cache_type: Type of cache ("stationboard", "locations", etc.)
            cache_key: Hash key from _make_cache_key()

        Returns:
            Full path to cache file
        """
        cache_dir = self.cache_dir / cache_type
        cache_dir.mkdir(exist_ok=True)
        return cache_dir / f"{cache_key}.json"

    def load_from_cache(self, cache_type: str, *args, **kwargs) -> Optional[Any]:
        """
        Load data from cache if it exists.

        Args:
            cache_type: Type of cache ("stationboard", "locations", etc.)
            *args: Arguments to generate cache key
            **kwargs: Keyword arguments to generate cache key

        Returns:
            Cached data or None if not found
        """
        cache_key = self._make_cache_key(*args, **kwargs)
        cache_path = self._get_cache_path(cache_type, cache_key)

        if cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    cached_record = json.load(f)
                    # Extract just the data from the wrapper
                    data = cached_record.get("data")
                    self.stats["hits"] += 1
                    return data
            except (json.JSONDecodeError, IOError) as e:
                # Cache file corrupted, return None to trigger API call
                print(f"Warning: Cache file corrupted ({cache_path}): {e}")
                return None

        return None

    def save_to_cache(self, cache_type: str, data: Any, *args, **kwargs) -> bool:
        """
        Save data to cache.

        Args:
            cache_type: Type of cache ("stationboard", "locations", etc.)
            data: Data to cache
            *args: Arguments to generate cache key
            **kwargs: Keyword arguments to generate cache key

        Returns:
            True if saved successfully, False otherwise
        """
        cache_key = self._make_cache_key(*args, **kwargs)
        cache_path = self._get_cache_path(cache_type, cache_key)

        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "cached_at": time.time(),
                        "data": data,
                        "cache_key": cache_key,
                        "args": list(args),
                        "kwargs": kwargs,
                    },
                    f,
                    indent=2,
                )
            return True
        except IOError as e:
            print(f"Warning: Failed to save cache ({cache_path}): {e}")
            return False

    def get_or_fetch(
        self,
        cache_type: str,
        fetch_func: Callable,
        cache_key_args: Tuple = (),
        cache_key_kwargs: Dict = None,
    ) -> Any:
        """
        Get data from cache or fetch it using the provided function.

        This is the main entry point. It:
        1. Checks if data is in cache
        2. If found: returns cached data
        3. If not found: calls fetch_func(), saves result, returns it

        Args:
            cache_type: Type of cache ("stationboard", "locations", etc.)
            fetch_func: Function to call if cache miss (takes no arguments)
            cache_key_args: Arguments to use for generating cache key
            cache_key_kwargs: Keyword arguments to use for generating cache key

        Returns:
            Fetched or cached data
        """
        if cache_key_kwargs is None:
            cache_key_kwargs = {}

        self.stats["total_calls"] += 1

        # Try to load from cache
        cached_data = self.load_from_cache(
            cache_type, *cache_key_args, **cache_key_kwargs
        )
        if cached_data is not None:

            return cached_data

        # Cache miss: call the fetch function
        self.stats["misses"] += 1
        result = fetch_func()

        # Save to cache for future runs
        self.save_to_cache(cache_type, result, *cache_key_args, **cache_key_kwargs)

        return result

    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        hit_rate = (
            self.stats["hits"] / self.stats["total_calls"] * 100
            if self.stats["total_calls"] > 0
            else 0
        )
        return {
            **self.stats,
            "hit_rate": hit_rate,
        }

    def clear_cache(self, cache_type: Optional[str] = None):
        """
        Clear cache.

        Args:
            cache_type: Specific cache type to clear, or None to clear all
        """
        if cache_type:
            import shutil

            cache_dir = self.cache_dir / cache_type
            if cache_dir.exists():
                shutil.rmtree(cache_dir)
                cache_dir.mkdir(exist_ok=True)
        else:
            import shutil

            if self.cache_dir.exists():
                shutil.rmtree(self.cache_dir)
            self.cache_dir.mkdir(exist_ok=True)
            self.stationboard_cache.mkdir(exist_ok=True)
            self.locations_cache.mkdir(exist_ok=True)


# Global cache instance
_global_cache = None


def get_cache(cache_dir: str = "api_cache") -> APICache:
    """
    Get or create the global cache instance.

    Args:
        cache_dir: Directory for cache storage

    Returns:
        APICache instance
    """
    global _global_cache
    if _global_cache is None:
        _global_cache = APICache(cache_dir)
    return _global_cache


def cached_api_call(cache_type: str, fetch_func: Callable, *args, **kwargs) -> Any:
    """
    Convenience function to make a cached API call.

    Args:
        cache_type: Type of cache ("stationboard", "locations", etc.)
        fetch_func: Function to call to fetch data
        *args: Arguments to fetch_func
        **kwargs: Keyword arguments to fetch_func

    Returns:
        Cached or freshly fetched data
    """
    cache = get_cache()
    return cache.get_or_fetch(cache_type, fetch_func, *args, **kwargs)
