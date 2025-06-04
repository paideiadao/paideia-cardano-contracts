"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, ExternalLink, Users, Clock, Coins } from "lucide-react";
import Link from "next/link";
import { DAOListItem } from "@/app/api/dao/list/route";

export default function BrowseDAOsPage() {
  const [daos, setDaos] = useState<DAOListItem[]>([]);
  const [filteredDaos, setFilteredDaos] = useState<DAOListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchDAOs();
  }, []);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredDaos(daos);
    } else {
      const filtered = daos.filter(
        (dao) =>
          dao.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          dao.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredDaos(filtered);
    }
  }, [searchTerm, daos]);

  const fetchDAOs = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/dao/list");
      if (!response.ok) {
        throw new Error("Failed to fetch DAOs");
      }

      const data = await response.json();
      setDaos(data.daos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load DAOs");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading DAOs...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Browse DAOs</h1>
          <p className="text-muted-foreground">
            Discover and participate in decentralized organizations
          </p>
        </div>
        <Link href="/create-dao">
          <Button>Create New DAO</Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search DAOs by name or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium">Total DAOs</span>
            </div>
            <p className="text-2xl font-bold">{daos.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-green-600" />
              <span className="text-sm font-medium">Filtered Results</span>
            </div>
            <p className="text-2xl font-bold">{filteredDaos.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium">Active Governance</span>
            </div>
            <p className="text-2xl font-bold">
              {filteredDaos.filter((dao) => dao.quorum > 0).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* DAO Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredDaos.map((dao) => (
          <Card key={`${dao.policyId}-${dao.assetName}`} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg line-clamp-1">{dao.name}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {dao.description || "No description available"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    window.open(
                      `https://${process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "" : "preview."}cardanoscan.io/transaction/${dao.utxoRef.txHash}`,
                      "_blank"
                    )
                  }
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Governance Token */}
              <div>
                <h4 className="text-sm font-medium mb-1">Governance Token</h4>
                <p className="text-xs text-muted-foreground font-mono">
                  {dao.governanceToken.policyId.slice(0, 8)}...
                  {dao.governanceToken.assetName || "(ADA)"}
                </p>
              </div>

              {/* Voting Parameters */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Threshold</p>
                  <p className="text-sm font-medium">{dao.threshold}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Quorum</p>
                  <p className="text-sm font-medium">{dao.quorum.toLocaleString()}</p>
                </div>
              </div>

              {/* Proposal Timing */}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Proposal Duration</p>
                <div className="flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  <span>
                    {formatDuration(dao.minProposalTime)} - {formatDuration(dao.maxProposalTime)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2">
                <Link href={`/dao/${dao.policyId}/${dao.assetName}`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    View DAO
                  </Button>
                </Link>
                <Link href={`/dao/${dao.policyId}/${dao.assetName}/proposals`} className="flex-1">
                  <Button size="sm" className="w-full">
                    Proposals
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredDaos.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm.trim() ? "No DAOs match your search." : "No DAOs found."}
          </p>
          {!searchTerm.trim() && (
            <Link href="/create-dao" className="mt-4 inline-block">
              <Button>Create the First DAO</Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}