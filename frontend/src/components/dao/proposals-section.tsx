"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Search,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import { ProposalInfo } from "@/app/api/dao/proposals/route";

interface ProposalsSectionProps {
  daoPolicyId: string;
  daoKey: string;
  isUserRegistered: boolean;
}

export function ProposalsSection({
  daoPolicyId,
  daoKey,
  isUserRegistered,
}: ProposalsSectionProps) {
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [filteredProposals, setFilteredProposals] = useState<ProposalInfo[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    fetchProposals();
  }, [daoPolicyId, daoKey]);

  useEffect(() => {
    applyFilters();
  }, [proposals, searchTerm, statusFilter, sortBy]);

  const fetchProposals = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/dao/proposals?daoPolicyId=${encodeURIComponent(
          daoPolicyId
        )}&daoKey=${encodeURIComponent(daoKey)}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch proposals");
      }

      const data = await response.json();
      setProposals(data.proposals);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load proposals");
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...proposals];

    if (searchTerm.trim()) {
      filtered = filtered.filter(
        (proposal) =>
          proposal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          proposal.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (statusFilter !== "all") {
      const statusMap: Record<string, string[]> = {
        active: ["Active"],
        passed: ["Passed"],
        failed: ["FailedThreshold", "FailedQuorum"],
      };
      filtered = filtered.filter((proposal) =>
        statusMap[statusFilter]?.includes(proposal.status)
      );
    }

    switch (sortBy) {
      case "oldest":
        filtered.sort((a, b) => a.endTime - b.endTime);
        break;
      case "ending-soon":
        filtered = filtered
          .filter((p) => p.status === "Active")
          .sort((a, b) => a.endTime - b.endTime);
        break;
      case "most-votes":
        filtered.sort((a, b) => b.totalVotes - a.totalVotes);
        break;
      case "newest":
      default:
        filtered.sort((a, b) => b.endTime - a.endTime);
        break;
    }

    setFilteredProposals(filtered);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Active":
        return <Clock className="h-4 w-4 text-blue-600" />;
      case "Passed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "FailedThreshold":
      case "FailedQuorum":
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "Active":
        return "default" as const;
      case "Passed":
        return "default" as const;
      case "FailedThreshold":
      case "FailedQuorum":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  };

  const formatTimeRemaining = (endTime: number) => {
    const now = Date.now();
    const timeLeft = endTime - now;

    if (timeLeft <= 0) return "Ended";

    const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const getWinningOption = (proposal: ProposalInfo) => {
    if (proposal.status !== "Passed" || !proposal.tally.length) return null;

    const maxVotes = Math.max(...proposal.tally);
    const winningIndex = proposal.tally.findIndex(
      (votes) => votes === maxVotes
    );

    return {
      index: winningIndex,
      votes: maxVotes,
      percentage:
        proposal.totalVotes > 0
          ? Math.round((maxVotes / proposal.totalVotes) * 100)
          : 0,
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading proposals...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search proposals..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="ending-soon">Ending Soon</SelectItem>
                <SelectItem value="most-votes">Most Votes</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {filteredProposals.length === 0 && !isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm.trim() || statusFilter !== "all"
              ? "No proposals match your filters."
              : "No proposals found."}
          </p>
          {isUserRegistered && (
            <Link
              href={`/dao/create-proposal?policyId=${daoPolicyId}&assetName=${daoKey}`}
            >
              <Button className="mt-4">Create First Proposal</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProposals.slice(0, 5).map((proposal) => {
            const winningOption = getWinningOption(proposal);

            return (
              <Card key={`${proposal.policyId}-${proposal.assetName}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(proposal.status)}
                        <CardTitle className="text-base line-clamp-1">
                          {proposal.name}
                        </CardTitle>
                        <Badge
                          variant={getStatusBadgeVariant(proposal.status)}
                          className="text-xs"
                        >
                          {proposal.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {proposal.description}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Compact voting results */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium">Results</span>
                      <span className="text-xs text-muted-foreground">
                        {proposal.totalVotes} votes
                      </span>
                    </div>
                    <div className="space-y-1">
                      {proposal.tally.slice(0, 3).map((votes, index) => {
                        const percentage =
                          proposal.totalVotes > 0
                            ? Math.round((votes / proposal.totalVotes) * 100)
                            : 0;
                        const isWinning = winningOption?.index === index;

                        return (
                          <div key={index} className="flex items-center gap-2">
                            <span className="text-xs w-12">Opt {index}</span>
                            <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                              <div
                                className={`h-1.5 rounded-full ${
                                  isWinning ? "bg-green-500" : "bg-blue-500"
                                }`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-xs w-8 text-right">
                              {percentage}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Timing and action */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {proposal.status === "Active"
                          ? formatTimeRemaining(proposal.endTime)
                          : `Ended ${new Date(
                              proposal.endTime
                            ).toLocaleDateString()}`}
                      </span>
                    </div>
                    <Link
                      href={`/dao/proposal/${proposal.policyId}/${proposal.assetName}?daoPolicyId=${daoPolicyId}&daoKey=${daoKey}`}
                    >
                      <Button variant="outline" size="sm">
                        View
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {filteredProposals.length > 5 && (
            <div className="text-center">
              <Link
                href={`/dao/proposals?daoPolicyId=${daoPolicyId}&daoKey=${daoKey}`}
              >
                <Button variant="outline">
                  View All {filteredProposals.length} Proposals
                </Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
